import React, { useState, useCallback } from 'react';
import {
  ScanSearch, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ChevronDown, ChevronRight, ImageOff,
  Clock, User, Ruler, Layers, Calendar, PenLine,
  Play, RotateCcw, Archive, Info
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface DrillLayer {
  layerNumber: number;
  designLayerCode: string;
  layerDesign: string;
  timeFrom: string;
  timeTo: string;
  dateFrom: string;
  dateTo: string;
  elevationFrom: number;
  elevationTo: number;
  actualGeology: string;
  notes: string;
  durationHours: number;
  lengthMeters: number;
  speedMph: number;
}

interface ExtractionResult {
  id: string;
  timestamp: number;
  project: string;
  item: string;
  componentName: string;
  pileId: string;
  reportNumber: string;
  diameter: string;
  constructionStart: string;
  constructionEnd: string;
  layers: DrillLayer[];
  notes: string;
  fileName?: string;
  fileUrl?: string;
  stt?: number;
  _base64?: string;
  _mimeType?: string;
  casingElevation?: number | null;
}

// ─────────────────────────────────────────
// Scan result types
// ─────────────────────────────────────────
type FieldStatus = 'match' | 'mismatch' | 'unreadable' | 'missing';

interface FieldCheck {
  field: string;
  label: string;
  dbValue: string;
  imageValue: string;
  status: FieldStatus;
  confidence: number; // 0-100
  note?: string;
}

interface LayerCheck {
  layerIndex: number;
  fields: FieldCheck[];
}

interface ScanReport {
  resultId: string;
  pileId: string;
  project: string;
  fileName?: string;
  fileUrl?: string;
  // Header fields
  headerFields: FieldCheck[];
  // Per-layer fields
  layers: LayerCheck[];
  // Signature check
  signatureCheck: { found: boolean; note: string };
  // Summary
  totalFields: number;
  matchedFields: number;
  mismatchedFields: number;
  unreadableFields: number;
  scannedAt: number;
  imageBase64?: string; // for display
}

// ─────────────────────────────────────────
// Fetch image (mirrors ensureImageData in App.tsx)
// ─────────────────────────────────────────
async function fetchImageBase64(
  result: ExtractionResult,
  githubToken?: string
): Promise<{ base64: string; mimeType: string } | null> {
  // 1. Use _base64 if available in memory
  if (result._base64) {
    const parts = result._base64.split(',');
    if (parts.length > 1) {
      return { base64: parts[1], mimeType: result._mimeType || 'image/jpeg' };
    }
  }

  // 2. Fetch from fileUrl via proxy
  if (result.fileUrl) {
    let url = result.fileUrl;
    if (url.includes('github.com') && url.includes('/blob/')) {
      url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }
    // Try proxy first
    try {
      const resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        if (buf.byteLength > 100) {
          const mime = resp.headers.get('content-type') || 'image/jpeg';
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          return { base64: b64, mimeType: mime };
        }
      }
    } catch { /* fall through */ }

    // Try direct with token
    try {
      const headers: HeadersInit = {};
      if (githubToken) headers['Authorization'] = `token ${githubToken}`;
      const resp = await fetch(url, { headers, cache: 'no-store' });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        if (buf.byteLength > 100) {
          const mime = resp.headers.get('content-type') || 'image/jpeg';
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          return { base64: b64, mimeType: mime };
        }
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ─────────────────────────────────────────
// AI Deep Scan — the careful employee
// ─────────────────────────────────────────
async function runDeepScan(
  result: ExtractionResult,
  imageBase64: string,
  mimeType: string,
  apiKey: string,
): Promise<Omit<ScanReport, 'resultId' | 'pileId' | 'project' | 'fileName' | 'fileUrl' | 'scannedAt' | 'imageBase64'>> {
  const ai = new GoogleGenAI({ apiKey });

  // ── Build compact DB table for prompt ──
  const headerDB = [
    { field: 'pileId',            label: 'Số hiệu cọc',    dbValue: result.pileId || '' },
    { field: 'reportNumber',      label: 'Số biên bản',     dbValue: result.reportNumber || '' },
    { field: 'diameter',          label: 'Đường kính',      dbValue: result.diameter || '' },
    { field: 'constructionStart', label: 'Bắt đầu thi công',dbValue: result.constructionStart || '' },
    { field: 'constructionEnd',   label: 'Kết thúc thi công',dbValue: result.constructionEnd || '' },
  ];

  const layersDB = (result.layers || []).map((l, i) => ({
    stt: i + 1,
    timeFrom:      l.timeFrom,
    timeTo:        l.timeTo,
    dateFrom:      l.dateFrom,
    dateTo:        l.dateTo,
    elevationFrom: l.elevationFrom,
    elevationTo:   l.elevationTo,
    lengthMeters:  l.lengthMeters,
    durationHours: l.durationHours,
    speedMph:      l.speedMph,
  }));

  // ── Prompt — lean, JSON-only, no signature ──
  const prompt = `Bạn là chuyên viên kiểm tra biên bản khoan cọc. Hãy đọc ảnh và đối chiếu với database.

DATABASE HEADER:
${headerDB.map(h => `${h.label}: ${h.dbValue}`).join('\n')}

DATABASE LAYERS (${layersDB.length} lớp):
${layersDB.map(l => `Lớp ${l.stt}: TỪ=${l.timeFrom} ĐẾN=${l.timeTo} | ngày ${l.dateFrom}→${l.dateTo} | CĐ ${l.elevationFrom}→${l.elevationTo} | DÀI=${l.lengthMeters}m | TG=${l.durationHours}h | V=${l.speedMph}m/h`).join('\n')}

NHIỆM VỤ: Đọc từng ô trong ảnh, so sánh với database. Chỉ tập trung vào:
1. Header: Số hiệu cọc, Số BB, Đường kính, Ngày bắt đầu, Ngày kết thúc
2. Mỗi lớp: TỪ (H), ĐẾN (H), Ngày từ, Ngày đến, Cao độ từ, Cao độ đến, Dài (m), T.Gian (h), V (m/h)

Quy tắc status: "match"=khớp, "mismatch"=sai, "unreadable"=không đọc được trong ảnh

CHỈ trả về JSON sau, KHÔNG có text nào khác, KHÔNG có markdown:
{"headerFields":[{"field":"pileId","label":"Số hiệu cọc","dbValue":"${result.pileId}","imageValue":"<đọc từ ảnh>","status":"match","confidence":95},{"field":"reportNumber","label":"Số biên bản","dbValue":"${result.reportNumber}","imageValue":"<đọc từ ảnh>","status":"match","confidence":90},{"field":"diameter","label":"Đường kính","dbValue":"${result.diameter}","imageValue":"<đọc từ ảnh>","status":"match","confidence":90},{"field":"constructionStart","label":"Bắt đầu","dbValue":"${result.constructionStart}","imageValue":"<đọc từ ảnh>","status":"match","confidence":85},{"field":"constructionEnd","label":"Kết thúc","dbValue":"${result.constructionEnd}","imageValue":"<đọc từ ảnh>","status":"match","confidence":85}],"layers":[${layersDB.map(l => `{"layerIndex":${l.stt-1},"fields":[{"field":"timeFrom","label":"TỪ (H)","dbValue":"${l.timeFrom}","imageValue":"<đọc>","status":"match","confidence":90},{"field":"timeTo","label":"ĐẾN (H)","dbValue":"${l.timeTo}","imageValue":"<đọc>","status":"match","confidence":90},{"field":"dateFrom","label":"Ngày từ","dbValue":"${l.dateFrom}","imageValue":"<đọc>","status":"match","confidence":85},{"field":"dateTo","label":"Ngày đến","dbValue":"${l.dateTo}","imageValue":"<đọc>","status":"match","confidence":85},{"field":"elevationFrom","label":"Cao độ từ","dbValue":"${l.elevationFrom}","imageValue":"<đọc>","status":"match","confidence":90},{"field":"elevationTo","label":"Cao độ đến","dbValue":"${l.elevationTo}","imageValue":"<đọc>","status":"match","confidence":90},{"field":"lengthMeters","label":"Dài (m)","dbValue":"${l.lengthMeters}","imageValue":"<đọc>","status":"match","confidence":88},{"field":"durationHours","label":"T.Gian (h)","dbValue":"${l.durationHours}","imageValue":"<đọc>","status":"match","confidence":85},{"field":"speedMph","label":"V (m/h)","dbValue":"${l.speedMph}","imageValue":"<đọc>","status":"match","confidence":85}]}`).join(',')}]}

Điền đúng imageValue từ ảnh, đổi status thành "mismatch" nếu khác database, "unreadable" nếu không đọc được. Giữ nguyên cấu trúc JSON, chỉ thay các giá trị trong dấu <>.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{
      parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: prompt },
      ],
    }],
  });

  // ── Robust JSON extraction ──
  const raw = (response.text || '').trim();
  let parsed: any = null;

  // Strategy 1: direct parse
  try { parsed = JSON.parse(raw); } catch { /* */ }

  // Strategy 2: strip markdown fences
  if (!parsed) {
    try {
      const stripped = raw.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '').trim();
      parsed = JSON.parse(stripped);
    } catch { /* */ }
  }

  // Strategy 3: extract first {...} block
  if (!parsed) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* */ }
    }
  }

  // Strategy 4: if all fail, build empty structure so UI still renders
  if (!parsed) {
    console.error('[DeepScan] Failed to parse AI response:', raw.slice(0, 500));
    // Return a special error marker so UI can show the raw response
    return {
      headerFields: [],
      layers: [],
      signatureCheck: { found: false, note: '' },
      totalFields: 0,
      matchedFields: 0,
      mismatchedFields: 0,
      unreadableFields: 0,
      _rawAiResponse: raw.slice(0, 1000),
    } as any;
  }

  const headerFields: FieldCheck[] = (parsed.headerFields || []).map((f: any) => ({
    field: f.field || '',
    label: f.label || '',
    dbValue: String(f.dbValue ?? ''),
    imageValue: String(f.imageValue ?? ''),
    status: (['match','mismatch','unreadable','missing'].includes(f.status) ? f.status : 'unreadable') as FieldStatus,
    confidence: Number(f.confidence) || 0,
    note: f.note || '',
  }));

  const layers: LayerCheck[] = (parsed.layers || []).map((l: any) => ({
    layerIndex: Number(l.layerIndex) || 0,
    fields: (l.fields || []).map((f: any) => ({
      field: f.field || '',
      label: f.label || '',
      dbValue: String(f.dbValue ?? ''),
      imageValue: String(f.imageValue ?? ''),
      status: (['match','mismatch','unreadable','missing'].includes(f.status) ? f.status : 'unreadable') as FieldStatus,
      confidence: Number(f.confidence) || 0,
      note: f.note || '',
    })),
  }));

  const signatureCheck = { found: false, note: 'Không kiểm tra chữ ký' };

  const allFields = [
    ...headerFields,
    ...layers.flatMap((l: LayerCheck) => l.fields),
  ];
  const totalFields = allFields.length;
  const matchedFields = allFields.filter(f => f.status === 'match').length;
  const mismatchedFields = allFields.filter(f => f.status === 'mismatch').length;
  const unreadableFields = allFields.filter(f => f.status === 'unreadable' || f.status === 'missing').length;

  return { headerFields, layers, signatureCheck, totalFields, matchedFields, mismatchedFields, unreadableFields };
}

// ─────────────────────────────────────────
// FieldRow UI
// ─────────────────────────────────────────
function FieldRow({ field }: { field: FieldCheck }) {
  const statusConfig = {
    match: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />, textDb: 'text-emerald-800', textImg: 'text-emerald-600' },
    mismatch: { bg: 'bg-red-50', border: 'border-red-200', icon: <XCircle size={14} className="text-red-500 flex-shrink-0" />, textDb: 'text-slate-700', textImg: 'text-red-700' },
    unreadable: { bg: 'bg-amber-50', border: 'border-amber-200', icon: <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />, textDb: 'text-slate-700', textImg: 'text-amber-700' },
    missing: { bg: 'bg-slate-50', border: 'border-slate-200', icon: <AlertTriangle size={14} className="text-slate-400 flex-shrink-0" />, textDb: 'text-slate-700', textImg: 'text-slate-400' },
  };
  const s = statusConfig[field.status] || statusConfig.missing;

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${s.bg} ${s.border} text-xs`}>
      {s.icon}
      <span className="font-bold text-slate-600 w-24 flex-shrink-0">{field.label}</span>
      {/* DB value */}
      <span className={`font-mono ${s.textDb} flex-1 truncate`}>{field.dbValue || '—'}</span>
      {/* Arrow */}
      <span className="text-slate-300 flex-shrink-0">→</span>
      {/* Image value */}
      <span className={`font-mono font-bold ${s.textImg} flex-1 truncate`}>
        {field.status === 'match' ? field.imageValue || field.dbValue :
         field.status === 'mismatch' ? (field.imageValue || '?') :
         field.status === 'unreadable' ? 'Không đọc được' : 'Không tìm thấy'}
      </span>
      {/* Confidence */}
      <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
        field.confidence >= 90 ? 'bg-emerald-100 text-emerald-700' :
        field.confidence >= 70 ? 'bg-amber-100 text-amber-700' :
        'bg-red-100 text-red-700'
      }`}>
        {field.confidence}%
      </span>
      {field.note && field.status !== 'match' && (
        <span className="text-slate-500 italic text-[10px] flex-shrink-0 max-w-[120px] truncate">{field.note}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// ScanReportView — show results split screen
// ─────────────────────────────────────────
function ScanReportView({ report }: { report: ScanReport }) {
  const [expandedLayers, setExpandedLayers] = useState<Set<number>>(new Set([0]));
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);

  const toggleLayer = (i: number) => {
    setExpandedLayers(prev => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  };

  const accuracy = report.totalFields > 0
    ? Math.round((report.matchedFields / report.totalFields) * 100)
    : 0;

  const rawResponse = (report as any)._rawAiResponse as string | undefined;

  const accuracyColor = accuracy >= 95 ? 'text-emerald-600' : accuracy >= 80 ? 'text-amber-600' : 'text-red-600';
  const accuracyBg = accuracy >= 95 ? 'bg-emerald-50 border-emerald-200' : accuracy >= 80 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  return (
    <div className="flex gap-4 h-full min-h-0">

      {/* LEFT: Image */}
      <div className="w-[45%] flex-shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-blue-500 rounded-full" />
          <span className="text-xs font-black text-slate-700 uppercase tracking-wide">Ảnh gốc biên bản</span>
        </div>
        <div className="flex-1 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 min-h-[400px] flex items-center justify-center">
          {report.imageBase64 ? (
            <img
              src={`data:image/jpeg;base64,${report.imageBase64}`}
              alt="Biên bản gốc"
              className="w-full h-full object-contain"
              style={{ maxHeight: '70vh' }}
            />
          ) : report.fileUrl ? (
            <img
              src={report.fileUrl}
              alt="Biên bản gốc"
              className="w-full h-full object-contain"
              crossOrigin="anonymous"
              style={{ maxHeight: '70vh' }}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-500 p-8">
              <ImageOff size={32} />
              <p className="text-xs text-center">Không tải được ảnh gốc.<br />Kết quả AI vẫn hợp lệ.</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Results */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: '75vh' }}>

        {/* Summary bar */}
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-purple-500 rounded-full" />
          <span className="text-xs font-black text-slate-700 uppercase tracking-wide">Kết quả kiểm tra</span>
        </div>

        {/* Debug: show raw AI response if parsing failed */}
        {rawResponse && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs">
            <p className="font-black text-amber-800 mb-2 flex items-center gap-1">
              <AlertTriangle size={13} /> AI trả về không phải JSON — nội dung thô:
            </p>
            <pre className="text-amber-700 whitespace-pre-wrap break-all font-mono text-[10px] max-h-48 overflow-y-auto bg-amber-100 rounded p-2">
              {rawResponse}
            </pre>
          </div>
        )}
        <div className={`rounded-xl border p-4 ${accuracyBg}`}>
          <div className="flex items-center justify-between">
            <div>
              <span className={`text-3xl font-black ${accuracyColor}`}>{accuracy}%</span>
              <span className="text-xs text-slate-500 ml-2 font-medium">độ khớp</span>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 size={12} />{report.matchedFields} khớp</span>
              <span className="flex items-center gap-1 font-bold text-red-700"><XCircle size={12} />{report.mismatchedFields} sai</span>
              <span className="flex items-center gap-1 font-bold text-amber-700"><AlertTriangle size={12} />{report.unreadableFields} không đọc được</span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-2 bg-white/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${accuracy >= 95 ? 'bg-emerald-500' : accuracy >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${accuracy}%` }}
            />
          </div>
        </div>

        {/* Filter toggle */}
        {report.mismatchedFields > 0 && (
          <button
            onClick={() => setShowOnlyIssues(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all self-start ${
              showOnlyIssues ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <AlertTriangle size={12} />
            {showOnlyIssues ? 'Hiện tất cả' : `Chỉ xem lỗi (${report.mismatchedFields + report.unreadableFields})`}
          </button>
        )}

        {/* Header fields */}
        <div className="space-y-1">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <Info size={10} /> Thông tin biên bản
          </p>
          {report.headerFields
            .filter(f => !showOnlyIssues || f.status !== 'match')
            .map((f, i) => <FieldRow key={i} field={f} />)}
          {report.headerFields.length === 0 && (
            <p className="text-xs text-slate-400 italic px-2">Không có dữ liệu header</p>
          )}
        </div>

        {/* Signature — hidden per user request */}


        {/* Layers */}
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1 mt-1">
          <Layers size={10} /> Các lớp địa chất ({report.layers.length} lớp)
        </p>
        {report.layers.map((layer, i) => {
          const layerIssues = layer.fields.filter(f => f.status !== 'match');
          const hasIssues = layerIssues.length > 0;
          if (showOnlyIssues && !hasIssues) return null;
          const isExpanded = expandedLayers.has(i);

          return (
            <div key={i} className={`rounded-xl border overflow-hidden ${
              hasIssues ? 'border-red-200' : 'border-emerald-200'
            }`}>
              <button
                onClick={() => toggleLayer(i)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-black transition-colors ${
                  hasIssues
                    ? 'bg-red-50 hover:bg-red-100 text-red-800'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  {hasIssues
                    ? <XCircle size={13} className="text-red-500" />
                    : <CheckCircle2 size={13} className="text-emerald-500" />}
                  Lớp {i + 1}
                  {hasIssues && (
                    <span className="bg-red-200 text-red-800 px-1.5 py-0.5 rounded-full text-[10px]">
                      {layerIssues.length} vấn đề
                    </span>
                  )}
                </span>
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {isExpanded && (
                <div className="p-2 space-y-1 bg-white">
                  {layer.fields
                    .filter(f => !showOnlyIssues || f.status !== 'match')
                    .map((f, j) => <FieldRow key={j} field={f} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Queue item UI
// ─────────────────────────────────────────
type ScanStatus = 'pending' | 'scanning' | 'done' | 'error' | 'archived';

interface QueueItem {
  result: ExtractionResult;
  status: ScanStatus;
  report?: ScanReport;
  error?: string;
}

// ─────────────────────────────────────────
// Main component
// ─────────────────────────────────────────
export function DeepScanPanel({
  history,
  apiKey,
  githubToken,
}: {
  history: ExtractionResult[];
  apiKey: string;
  githubToken?: string;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [archivedReports, setArchivedReports] = useState<ScanReport[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeReport, setActiveReport] = useState<ScanReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [view, setView] = useState<'select' | 'queue' | 'archive'>('select');
  const [searchTerm, setSearchTerm] = useState('');

  const MAX_SELECT = 5;

  const filteredHistory = history.filter(r =>
    !searchTerm ||
    r.pileId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.project?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.fileName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) { s.delete(id); return s; }
      if (s.size >= MAX_SELECT) return prev;
      s.add(id); return s;
    });
  };

  const startScan = useCallback(async () => {
    if (!apiKey) { alert('Chưa có API Key Gemini. Vào Cài đặt để thêm.'); return; }
    if (selectedIds.size === 0) return;

    const selected = history.filter(r => selectedIds.has(r.id));
    const initialQueue: QueueItem[] = selected.map(r => ({ result: r, status: 'pending' }));
    setQueue(initialQueue);
    setView('queue');
    setIsScanning(true);
    setActiveReport(null);

    for (let i = 0; i < selected.length; i++) {
      const result = selected[i];

      // Mark as scanning
      setQueue(prev => prev.map((q, idx) =>
        idx === i ? { ...q, status: 'scanning' } : q
      ));

      try {
        // 1. Fetch image
        const imgData = await fetchImageBase64(result, githubToken);

        // 2. AI deep scan
        let scanResult;
        if (imgData) {
          scanResult = await runDeepScan(result, imgData.base64, imgData.mimeType, apiKey);
        } else {
          // No image — still do partial check with rule engine note
          scanResult = {
            headerFields: [] as FieldCheck[],
            layers: [] as LayerCheck[],
            signatureCheck: { found: false, note: 'Không có ảnh để kiểm tra chữ ký' },
            totalFields: 0,
            matchedFields: 0,
            mismatchedFields: 0,
            unreadableFields: 0,
          };
        }

        const report: ScanReport = {
          resultId: result.id,
          pileId: result.pileId,
          project: result.project,
          fileName: result.fileName,
          fileUrl: result.fileUrl,
          imageBase64: imgData?.base64,
          scannedAt: Date.now(),
          ...scanResult,
        };

        setQueue(prev => prev.map((q, idx) =>
          idx === i ? { ...q, status: 'done', report } : q
        ));

        // Auto-show first completed report
        if (i === 0) setActiveReport(report);

      } catch (err: any) {
        setQueue(prev => prev.map((q, idx) =>
          idx === i ? { ...q, status: 'error', error: err?.message || 'Lỗi không xác định' } : q
        ));
      }
    }

    setIsScanning(false);
  }, [selectedIds, history, apiKey, githubToken]);

  const archiveDone = () => {
    const done = queue.filter(q => q.status === 'done' && q.report);
    setArchivedReports(prev => {
      const existingIds = new Set(prev.map(r => r.resultId));
      const newReports = done.map(q => q.report!).filter(r => !existingIds.has(r.resultId));
      return [...prev, ...newReports];
    });
    // Mark as archived in queue
    setQueue(prev => prev.map(q =>
      q.status === 'done' ? { ...q, status: 'archived' } : q
    ));
  };

  const resetSelection = () => {
    setSelectedIds(new Set());
    setQueue([]);
    setActiveReport(null);
    setView('select');
  };

  const doneCount = queue.filter(q => q.status === 'done').length;
  const archivedInQueue = queue.filter(q => q.status === 'archived').length;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-violet-500 rounded-full" />
          <div>
            <h3 className="text-[18px] font-black text-black uppercase tracking-tight">Rà soát chuyên sâu</h3>
            <p className="text-xs text-slate-500 font-medium">AI đọc từng ô ảnh gốc · đối chiếu database · báo cáo từng trường</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[
            { id: 'select', label: 'Chọn biên bản' },
            { id: 'queue', label: `Đang quét (${queue.length})` },
            { id: 'archive', label: `Đã quét (${archivedReports.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-all ${
                view === tab.id
                  ? tab.id === 'archive' ? 'bg-violet-500 text-white' : 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {tab.id === 'archive' && <Archive size={10} className="inline mr-1" />}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── SELECT VIEW ── */}
      {view === 'select' && (
        <div className="space-y-4">
          {/* Info banner */}
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-xs text-violet-800">
            <p className="font-black mb-1 flex items-center gap-2"><ScanSearch size={13} /> Cách hoạt động</p>
            <ul className="space-y-1 text-violet-700 list-disc list-inside">
              <li>Chọn tối đa <span className="font-black">5 biên bản</span> để quét chuyên sâu</li>
              <li>AI sẽ <span className="font-black">đọc từng ô trong ảnh gốc</span>, đối chiếu với database</li>
              <li>Kết quả hiển thị <span className="font-black">ảnh bên trái, so sánh bên phải</span>, highlight ô sai</li>
              <li>Biên bản đã quét sẽ vào <span className="font-black">Lưu trữ</span> để không phải quét lại</li>
            </ul>
          </div>

          {/* Search */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Tìm theo cọc, dự án, tên file..."
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <span className="text-xs text-slate-500 font-bold whitespace-nowrap">
              {selectedIds.size}/{MAX_SELECT} đã chọn
            </span>
          </div>

          {/* List */}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {filteredHistory.map(result => {
              const isSelected = selectedIds.has(result.id);
              const isArchived = archivedReports.some(r => r.resultId === result.id);
              const hasImage = !!(result._base64 || result.fileUrl);
              const disabled = !isSelected && selectedIds.size >= MAX_SELECT;

              return (
                <button
                  key={result.id}
                  onClick={() => !isArchived && toggleSelect(result.id)}
                  disabled={isArchived || disabled}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    isArchived
                      ? 'border-violet-200 bg-violet-50 opacity-60 cursor-default'
                      : isSelected
                      ? 'border-violet-400 bg-violet-50 shadow-sm'
                      : disabled
                      ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
                      : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/30'
                  }`}
                >
                  {/* Checkbox */}
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    isArchived ? 'border-violet-400 bg-violet-400' :
                    isSelected ? 'border-violet-500 bg-violet-500' : 'border-slate-300'
                  }`}>
                    {(isSelected || isArchived) && <div className="w-2.5 h-2.5 bg-white rounded-full" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-slate-900 truncate">{result.pileId || 'Không có ID'}</span>
                      {result.reportNumber && <span className="text-xs text-slate-400">#{result.reportNumber}</span>}
                      {isArchived && <span className="text-[10px] font-black px-2 py-0.5 bg-violet-200 text-violet-700 rounded-full">Đã quét</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">{result.project} · {result.fileName || 'Không có tên file'}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasImage
                      ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Có ảnh</span>
                      : <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Không có ảnh</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Start button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={startScan}
              disabled={selectedIds.size === 0 || isScanning}
              className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-black uppercase tracking-wide transition-all shadow-sm disabled:cursor-not-allowed"
            >
              <Play size={15} />
              Bắt đầu quét {selectedIds.size > 0 ? `(${selectedIds.size} biên bản)` : ''}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-bold transition-all"
              >
                <RotateCcw size={14} /> Bỏ chọn
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── QUEUE VIEW ── */}
      {view === 'queue' && (
        <div className="space-y-4">
          {/* Queue list + detail split */}
          <div className="flex gap-4" style={{ minHeight: '70vh' }}>

            {/* Left: queue */}
            <div className="w-64 flex-shrink-0 space-y-2">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Hàng đợi</p>
              {queue.map((item, i) => {
                const report = item.report;
                const accuracy = report && report.totalFields > 0
                  ? Math.round((report.matchedFields / report.totalFields) * 100)
                  : null;

                return (
                  <button
                    key={item.result.id}
                    onClick={() => item.report && setActiveReport(item.report)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all text-xs ${
                      activeReport?.resultId === item.result.id
                        ? 'border-violet-400 bg-violet-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-violet-300'
                    }`}
                  >
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {item.status === 'pending' && <Clock size={14} className="text-slate-400" />}
                      {item.status === 'scanning' && <Loader2 size={14} className="text-violet-500 animate-spin" />}
                      {item.status === 'done' && (
                        accuracy !== null && accuracy >= 95
                          ? <CheckCircle2 size={14} className="text-emerald-500" />
                          : <AlertTriangle size={14} className="text-amber-500" />
                      )}
                      {item.status === 'error' && <XCircle size={14} className="text-red-500" />}
                      {item.status === 'archived' && <Archive size={14} className="text-violet-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-800 truncate">{item.result.pileId}</p>
                      <p className="text-slate-400 truncate">{item.result.project}</p>
                    </div>
                    {accuracy !== null && (
                      <span className={`text-[10px] font-black flex-shrink-0 ${
                        accuracy >= 95 ? 'text-emerald-600' : accuracy >= 80 ? 'text-amber-600' : 'text-red-600'
                      }`}>{accuracy}%</span>
                    )}
                    {item.status === 'error' && (
                      <span className="text-[10px] text-red-500 truncate max-w-[80px]">{item.error}</span>
                    )}
                  </button>
                );
              })}

              {/* Archive button */}
              {doneCount > 0 && archivedInQueue < doneCount && (
                <button
                  onClick={archiveDone}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-xs font-black hover:bg-violet-100 transition-colors mt-3"
                >
                  <Archive size={13} /> Lưu {doneCount} biên bản đã quét
                </button>
              )}
              <button
                onClick={resetSelection}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                <RotateCcw size={12} /> Quét biên bản khác
              </button>
            </div>

            {/* Right: active report */}
            <div className="flex-1 min-w-0">
              {activeReport ? (
                <ScanReportView report={activeReport} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400">
                  <div className="text-center">
                    {isScanning
                      ? <><Loader2 size={32} className="animate-spin mx-auto mb-3 text-violet-400" /><p className="text-sm font-bold">Đang quét...</p></>
                      : <><ScanSearch size={32} className="mx-auto mb-3" /><p className="text-sm">Chọn biên bản bên trái để xem kết quả</p></>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ARCHIVE VIEW ── */}
      {view === 'archive' && (
        <div className="space-y-4">
          {archivedReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <Archive size={40} className="mb-4" />
              <p className="text-sm font-bold">Chưa có biên bản nào được lưu trữ</p>
              <p className="text-xs mt-1">Quét biên bản xong rồi bấm "Lưu vào lưu trữ"</p>
            </div>
          ) : (
            <div className="flex gap-4" style={{ minHeight: '70vh' }}>
              {/* Left: archive list */}
              <div className="w-64 flex-shrink-0 space-y-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Archive size={10} /> Đã quét ({archivedReports.length})
                </p>
                {archivedReports.map(report => {
                  const accuracy = report.totalFields > 0
                    ? Math.round((report.matchedFields / report.totalFields) * 100)
                    : null;
                  return (
                    <button
                      key={report.resultId}
                      onClick={() => setActiveReport(report)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all text-xs ${
                        activeReport?.resultId === report.resultId
                          ? 'border-violet-400 bg-violet-50'
                          : 'border-slate-200 bg-white hover:border-violet-300'
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {accuracy !== null && accuracy >= 95
                          ? <CheckCircle2 size={14} className="text-emerald-500" />
                          : <AlertTriangle size={14} className="text-amber-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-800 truncate">{report.pileId}</p>
                        <p className="text-slate-400 truncate text-[10px]">
                          {new Date(report.scannedAt).toLocaleDateString('vi-VN')}
                        </p>
                      </div>
                      {accuracy !== null && (
                        <span className={`text-[10px] font-black flex-shrink-0 ${
                          accuracy >= 95 ? 'text-emerald-600' : accuracy >= 80 ? 'text-amber-600' : 'text-red-600'
                        }`}>{accuracy}%</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Right: report detail */}
              <div className="flex-1 min-w-0">
                {activeReport ? (
                  <ScanReportView report={activeReport} />
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400">
                    <div className="text-center">
                      <Archive size={32} className="mx-auto mb-3" />
                      <p className="text-sm">Chọn biên bản để xem kết quả đã lưu</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
