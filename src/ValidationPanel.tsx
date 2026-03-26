import React, { useState, useCallback, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronRight, Eye, ShieldCheck, Loader2, Info, ExternalLink, Filter } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

// ─────────────────────────────────────────────
// Types (mirror từ App.tsx — không import để độc lập)
// ─────────────────────────────────────────────
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
  cumulativeDepth: number;
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
  reportType: 'A' | 'B';
  layers: DrillLayer[];
  notes: string;
  fileName?: string;
  fileUrl?: string;
  stt?: number;
  _base64?: string;
  _mimeType?: string;
  casingElevation?: number | null;
}

// ─────────────────────────────────────────────
// Validation types
// ─────────────────────────────────────────────
type IssueSeverity = 'error' | 'warning' | 'info';
type IssueType = 'math' | 'continuity' | 'ai_flag' | 'outlier';

interface ValidationIssue {
  layerIndex: number;   // -1 = toàn biên bản
  field: string;
  severity: IssueSeverity;
  type: IssueType;
  message: string;
  expected?: string;
  actual?: string;
}

interface ValidationReport {
  resultId: string;
  pileId: string;
  project: string;
  fileName?: string;
  fileUrl?: string;
  issues: ValidationIssue[];
  aiChecked: boolean;
  aiRawResponse?: string;
  checkedAt: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const toN = (v: any): number => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? NaN : n;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const parseHHMM = (t: string): number => {
  if (!t) return NaN;
  const m = t.replace(/h/i, ':').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
};

const fmt = (v: number | undefined, dec = 2) =>
  v === undefined || isNaN(v) ? '?' : v.toFixed(dec);

// ─────────────────────────────────────────────
// Rule Engine — 100% deterministic, không tốn API
// ─────────────────────────────────────────────
function runRuleEngine(result: ExtractionResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const layers = result.layers || [];
  const TOLERANCE = 0.06; // 3 phút tính theo giờ, cho phép làm tròn

  layers.forEach((layer, i) => {
    const idx = i;

    // ── 1. Kiểm tra durationHours ──
    const fromMin = parseHHMM(layer.timeFrom);
    const toMin = parseHHMM(layer.timeTo);
    if (!isNaN(fromMin) && !isNaN(toMin)) {
      let diffMin = toMin - fromMin;
      if (diffMin < 0) diffMin += 1440; // qua đêm
      const expectedHours = round2(diffMin / 60);
      const storedHours = toN(layer.durationHours);
      if (!isNaN(storedHours) && Math.abs(expectedHours - storedHours) > TOLERANCE) {
        issues.push({
          layerIndex: idx,
          field: 'T.GIAN (h)',
          severity: 'error',
          type: 'math',
          message: `T.GIAN không khớp giờ bắt đầu/kết thúc`,
          expected: `${fmt(expectedHours)} h (${layer.timeFrom} → ${layer.timeTo})`,
          actual: `${fmt(storedHours)} h`,
        });
      }
    }

    // ── 2. Kiểm tra lengthMeters ──
    const eFrom = toN(layer.elevationFrom);
    const eTo = toN(layer.elevationTo);
    if (!isNaN(eFrom) && !isNaN(eTo)) {
      const expectedLen = round2(Math.abs(eTo - eFrom));
      const storedLen = toN(layer.lengthMeters);
      if (!isNaN(storedLen) && Math.abs(expectedLen - storedLen) > 0.05) {
        issues.push({
          layerIndex: idx,
          field: 'DÀI (m)',
          severity: 'error',
          type: 'math',
          message: `Chiều dài không khớp cao độ`,
          expected: `${fmt(expectedLen)} m (|${fmt(eTo)} − ${fmt(eFrom)}|)`,
          actual: `${fmt(storedLen)} m`,
        });
      }
    }

    // ── 3. Kiểm tra speedMph = length / duration ──
    const len = toN(layer.lengthMeters);
    const dur = toN(layer.durationHours);
    const spd = toN(layer.speedMph);
    if (!isNaN(len) && !isNaN(dur) && dur > 0 && !isNaN(spd)) {
      const expectedSpeed = round2(len / dur);
      if (Math.abs(expectedSpeed - spd) > 0.05) {
        issues.push({
          layerIndex: idx,
          field: 'V (m/h)',
          severity: 'error',
          type: 'math',
          message: `Vận tốc không khớp DÀI / T.GIAN`,
          expected: `${fmt(expectedSpeed)} m/h (${fmt(len)} / ${fmt(dur)})`,
          actual: `${fmt(spd)} m/h`,
        });
      }
    }

    // ── 4. Phát hiện lỗi dấu thập phân (giá trị lớn bất thường x10) ──
    if (!isNaN(spd) && spd > 50) {
      issues.push({
        layerIndex: idx,
        field: 'V (m/h)',
        severity: 'warning',
        type: 'outlier',
        message: `Vận tốc bất thường (${fmt(spd)} m/h) — có thể lỗi dấu thập phân`,
        expected: `< 50 m/h`,
        actual: `${fmt(spd)} m/h`,
      });
    }
    if (!isNaN(len) && len > 100) {
      issues.push({
        layerIndex: idx,
        field: 'DÀI (m)',
        severity: 'warning',
        type: 'outlier',
        message: `Chiều dài bất thường (${fmt(len)} m) — có thể lỗi dấu thập phân`,
        expected: `< 100 m`,
        actual: `${fmt(len)} m`,
      });
    }

    // ── 5. Kiểm tra liên tục cao độ ──
    if (i > 0) {
      const prevLayer = layers[i - 1];
      const prevETo = toN(prevLayer.elevationTo);
      const curEFrom = toN(layer.elevationFrom);
      if (!isNaN(prevETo) && !isNaN(curEFrom) && Math.abs(prevETo - curEFrom) > 0.05) {
        issues.push({
          layerIndex: idx,
          field: 'CAO ĐỘ TỪ',
          severity: 'warning',
          type: 'continuity',
          message: `Cao độ không liên tục từ lớp ${i} → lớp ${i + 1}`,
          expected: `${fmt(prevETo)} m (bằng CAO ĐỘ ĐẾN lớp ${i})`,
          actual: `${fmt(curEFrom)} m`,
        });
      }
    }

    // ── 6. Kiểm tra liên tục thời gian ──
    if (i > 0) {
      const prevLayer = layers[i - 1];
      const prevToMin = parseHHMM(prevLayer.timeTo);
      const curFromMin = parseHHMM(layer.timeFrom);
      if (!isNaN(prevToMin) && !isNaN(curFromMin)) {
        // Cho phép nghỉ tối đa 30 phút
        let gap = curFromMin - prevToMin;
        if (gap < -1200) gap += 1440; // qua đêm
        if (gap < -5) {
          issues.push({
            layerIndex: idx,
            field: 'TỪ (H)',
            severity: 'warning',
            type: 'continuity',
            message: `Giờ bắt đầu sớm hơn giờ kết thúc lớp trước (chồng lấp ${Math.abs(gap)} phút)`,
            expected: `>= ${prevLayer.timeTo} (lớp ${i})`,
            actual: layer.timeFrom,
          });
        } else if (gap > 120) {
          issues.push({
            layerIndex: idx,
            field: 'TỪ (H)',
            severity: 'info',
            type: 'continuity',
            message: `Khoảng cách giờ lớn (${gap} phút) giữa lớp ${i} và ${i + 1}`,
            expected: `Liền tiếp với ${prevLayer.timeTo}`,
            actual: layer.timeFrom,
          });
        }
      }
    }

    // ── 7. Phát hiện lỗi nhận dạng chữ viết tay phổ biến (Heuristics) ──
    // Lỗi 0 vs 1: "0h" bị đọc thành "1h"
    if (layer.timeFrom.startsWith('1h') || layer.timeTo.startsWith('1h')) {
      issues.push({
        layerIndex: idx,
        field: 'GIỜ (H)',
        severity: 'info',
        type: 'ai_flag',
        message: `Phát hiện giờ "1h" — hãy kiểm tra kỹ ảnh gốc xem có phải là "0h" viết tay không (lỗi phổ biến).`,
      });
    }

    // Lỗi 9 vs 4: Phút có số 4 (VD: 23h44) có thể là số 9 (23h49)
    if (layer.timeFrom.endsWith('4') || layer.timeTo.endsWith('4')) {
      issues.push({
        layerIndex: idx,
        field: 'PHÚT',
        severity: 'info',
        type: 'ai_flag',
        message: `Phút kết thúc bằng "4" — hãy kiểm tra xem có phải là số "9" viết hở không (VD: 23h49 vs 23h44).`,
      });
    }

    // Lỗi nhận diện số trong Chiều dài (1 vs 2, 2 vs 7, 0 vs 1, 5 vs 0)
    const lenStr = String(layer.lengthMeters);
    if (lenStr === '2.6' || lenStr === '2.60') {
       issues.push({
         layerIndex: idx,
         field: 'DÀI (m)',
         severity: 'warning',
         type: 'ai_flag',
         message: `Giá trị "2.6" rất hay bị nhầm với "1.6" (số 1 có gạch chân). Hãy kiểm tra kỹ ảnh gốc.`,
         expected: '1.6 ?',
         actual: '2.6',
       });
    } else if (lenStr === '10.7' || lenStr === '10.70') {
       issues.push({
         layerIndex: idx,
         field: 'DÀI (m)',
         severity: 'warning',
         type: 'ai_flag',
         message: `Giá trị "10.7" rất hay bị nhầm với "10.2" (số 2 viết nhọn). Hãy kiểm tra kỹ ảnh gốc.`,
         expected: '10.2 ?',
         actual: '10.7',
       });
    } else if (lenStr === '11.7' || lenStr === '11.70') {
       issues.push({
         layerIndex: idx,
         field: 'DÀI (m)',
         severity: 'warning',
         type: 'ai_flag',
         message: `Giá trị "11.7" có thể là "10.7" hoặc "10.2". Hãy kiểm tra kỹ ảnh gốc.`,
         expected: '10.7 / 10.2 ?',
         actual: '11.7',
       });
    } else if (lenStr.endsWith('.0') || lenStr.endsWith('.00')) {
       issues.push({
         layerIndex: idx,
         field: 'DÀI (m)',
         severity: 'info',
         type: 'ai_flag',
         message: `Chiều dài kết thúc bằng ".0" — hãy kiểm tra xem có phải là số "5" viết bụng tròn không (VD: 6.5 vs 6.0).`,
       });
    }

    // ── 8. Kiểm tra Tích lũy (Type B) ──
    if (result.reportType === 'B') {
      const curLen = toN(layer.lengthMeters);
      const curCum = toN(layer.cumulativeDepth);
      if (i > 0) {
        const prevCum = toN(layers[i - 1].cumulativeDepth);
        if (!isNaN(prevCum) && !isNaN(curLen) && !isNaN(curCum)) {
          const expectedCum = round2(prevCum + curLen);
          if (Math.abs(expectedCum - curCum) > 0.05) {
            issues.push({
              layerIndex: idx,
              field: 'TÍCH LŨY (m)',
              severity: 'error',
              type: 'math',
              message: `Tích lũy không khớp (Trước: ${fmt(prevCum)} + Dài: ${fmt(curLen)} = ${fmt(expectedCum)})`,
              expected: `${fmt(expectedCum)} m`,
              actual: `${fmt(curCum)} m`,
            });
          }
        }
      } else {
        // Lớp đầu tiên
        if (!isNaN(curLen) && !isNaN(curCum) && Math.abs(curLen - curCum) > 0.5) {
           // Có thể có tích lũy từ trước đó, nhưng nếu lệch quá nhiều thì cảnh báo
           issues.push({
             layerIndex: idx,
             field: 'TÍCH LŨY (m)',
             severity: 'info',
             type: 'math',
             message: `Kiểm tra tích lũy lớp đầu tiên: ${fmt(curCum)} m (Chiều dài: ${fmt(curLen)} m)`,
           });
        }
      }
    }
  });

  return issues;
}

// ─────────────────────────────────────────────
// AI Cross-check via Gemini
// ─────────────────────────────────────────────
async function runAiCrossCheck(
  result: ExtractionResult,
  apiKey: string,
  suspiciousLayers: number[],
): Promise<{ issues: ValidationIssue[]; raw: string }> {
  if (!result._base64 && !result.fileUrl) {
    return { issues: [], raw: 'Không có ảnh gốc để kiểm tra' };
  }

  const ai = new GoogleGenAI({ apiKey });

  // Tóm tắt các lớp nghi ngờ để AI tập trung
  const layersSummary = result.layers.map((l, i) => ({
    lop: i + 1,
    tu_h: l.timeFrom,
    den_h: l.timeTo,
    cao_do_tu: l.elevationFrom,
    cao_do_den: l.elevationTo,
    dai_m: l.lengthMeters,
    t_gian_h: l.durationHours,
    v_mh: l.speedMph,
    dia_chat: l.actualGeology,
  }));

  const suspiciousSummary = suspiciousLayers.length > 0
    ? `\n\nCÁC LỚP CẦN ĐẶC BIỆT CHÚ Ý (rule engine phát hiện nghi ngờ): Lớp ${suspiciousLayers.map(i => i + 1).join(', ')}`
    : '';

  const prompt = `Bạn là chuyên gia kiểm tra độc lập biên bản khoan cọc nhồi cao cấp. 
Nhiệm vụ của bạn là đối soát dữ liệu đã trích xuất với hình ảnh gốc để phát hiện các sai sót, đặc biệt là lỗi nhận diện chữ viết tay.

DỮ LIỆU CẦN KIỂM TRA:
Cọc: ${result.pileId} | Dự án: ${result.project} | Đường kính: ${result.diameter}
Thi công: ${result.constructionStart} → ${result.constructionEnd}

Danh sách các lớp đã trích xuất:
${JSON.stringify(layersSummary, null, 2)}
${suspiciousSummary}

HƯỚNG DẪN KIỂM TRA (QUAN TRỌNG):
1. ĐỐI CHIẾU TỪNG Ô: Kiểm tra kỹ các cột: TỪ (H), ĐẾN (H), CAO ĐỘ TỪ, CAO ĐỘ ĐẾN, DÀI (M).
2. CẢNH GIÁC CHỮ VIẾT TAY:
   - Số "1" đầu giờ thường mảnh, dễ bị đọc sót (ví dụ: "17h20" trích xuất thành "7h20").
   - Số "9" và "4" viết tay dễ nhầm lẫn.
   - Số "1" và "2" trong cột Chiều dài dễ nhầm (ví dụ: "1,6" trích xuất thành "2,6").
   - Số "2" và "7" trong cột Chiều dài dễ nhầm (ví dụ: "10,2" trích xuất thành "10,7").
3. KIỂM TRA TÍNH LOGIC:
   - Thời gian phải tăng dần.
   - Cao độ phải liên tục (elevationTo lớp N = elevationFrom lớp N+1).
   - Toán học: (Cao độ từ) - (Chiều dài) = (Cao độ đến).

YÊU CẦU ĐẦU RA (JSON thuần):
{
  "summary": "Tóm tắt kết quả kiểm tra",
  "issues": [
    {
      "layer": 2,
      "field": "DÀI (M)",
      "image_value": "1,6",
      "extracted_value": "2,6",
      "confidence": "high",
      "note": "AI đọc nhầm số 1 thành số 2 do nét gạch chân dài"
    }
  ]
}

CHỈ báo lỗi nếu bạn CHẮC CHẮN dữ liệu trích xuất sai so với ảnh. Nếu khớp, trả về issues: [].`;

  let base64Data = result._base64;
  let mimeType = (result._mimeType || 'image/jpeg') as string;

  // Nếu không có _base64, thử fetch từ fileUrl
  if (!base64Data && result.fileUrl) {
    try {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(result.fileUrl)}`;
      const resp = await fetch(proxyUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        mimeType = blob.type || 'image/jpeg';
        const ab = await blob.arrayBuffer();
        base64Data = btoa(String.fromCharCode(...new Uint8Array(ab)));
      }
    } catch {
      return { issues: [], raw: 'Không thể tải ảnh gốc từ server' };
    }
  }

  if (!base64Data) {
    return { issues: [], raw: 'Không có ảnh để gửi AI kiểm tra' };
  }

  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: cleanBase64 } },
        { text: prompt },
      ],
    }],
  });

  const raw = response.text || '';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed: any = {};
  try { parsed = JSON.parse(cleaned); } catch { return { issues: [], raw }; }

  const aiIssues: ValidationIssue[] = (parsed.issues || []).map((issue: any) => ({
    layerIndex: (issue.layer || 1) - 1,
    field: issue.field || '',
    severity: issue.confidence === 'high' ? 'error' : 'warning',
    type: 'ai_flag' as IssueType,
    message: `AI đọc ảnh gốc: "${issue.image_value}" — trích xuất: "${issue.extracted_value}"${issue.note ? ` (${issue.note})` : ''}`,
    expected: issue.image_value,
    actual: issue.extracted_value,
  }));

  return { issues: aiIssues, raw };
}

// ─────────────────────────────────────────────
// Severity badge
// ─────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const map = {
    error: { bg: 'bg-red-100 text-red-700 border-red-200', label: 'Lỗi' },
    warning: { bg: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Cảnh báo' },
    info: { bg: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Lưu ý' },
  };
  const s = map[severity];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide border ${s.bg}`}>
      {s.label}
    </span>
  );
}

function TypeBadge({ type }: { type: IssueType }) {
  const map = {
    math: { bg: 'bg-red-50 text-red-600', label: 'Toán học' },
    continuity: { bg: 'bg-orange-50 text-orange-600', label: 'Liên tục' },
    ai_flag: { bg: 'bg-purple-50 text-purple-600', label: 'AI phát hiện' },
    outlier: { bg: 'bg-yellow-50 text-yellow-700', label: 'Bất thường' },
  };
  const s = map[type];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${s.bg}`}>
      {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// Row for a single ExtractionResult validation
// ─────────────────────────────────────────────
function ValidationRow({
  result,
  report,
  isRunningAi,
  onRunAi,
  onViewResult,
}: {
  result: ExtractionResult;
  report?: ValidationReport;
  isRunningAi: boolean;
  onRunAi: () => void;
  onViewResult: () => void; // mở edit modal
}) {
  const [expanded, setExpanded] = useState(false);

  const errorCount = report?.issues.filter(i => i.severity === 'error').length || 0;
  const warnCount = report?.issues.filter(i => i.severity === 'warning').length || 0;
  const infoCount = report?.issues.filter(i => i.severity === 'info').length || 0;
  const totalIssues = report?.issues.length || 0;

  const statusIcon = !report ? (
    <span className="w-5 h-5 rounded-full border-2 border-slate-300 inline-block" />
  ) : totalIssues === 0 ? (
    <CheckCircle2 size={18} className="text-emerald-500" />
  ) : errorCount > 0 ? (
    <XCircle size={18} className="text-red-500" />
  ) : (
    <AlertTriangle size={18} className="text-amber-500" />
  );

  const hasImage = !!(result._base64 || result.fileUrl);

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      !report ? 'border-slate-200 bg-white' :
      errorCount > 0 ? 'border-red-200 bg-red-50/30' :
      warnCount > 0 ? 'border-amber-200 bg-amber-50/20' :
      'border-emerald-200 bg-emerald-50/20'
    }`}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-black/5 transition-colors select-none"
        onClick={() => report && totalIssues > 0 && setExpanded(e => !e)}
      >
        <div className="flex-shrink-0">{statusIcon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black text-slate-900 truncate">{result.pileId || 'Không có ID'}</span>
            {result.reportNumber && <span className="text-xs text-slate-500 font-medium">#{result.reportNumber}</span>}
            <span className="text-xs text-slate-400 truncate hidden sm:block">{result.project}</span>
          </div>
          {result.fileName && (
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{result.fileName}</p>
          )}
        </div>

        {/* Issue badges */}
        {report && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {totalIssues === 0 ? (
              <span className="text-[11px] font-bold text-emerald-600">Không có lỗi</span>
            ) : (
              <>
                {errorCount > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[11px] font-black">
                    <XCircle size={10} /> {errorCount} lỗi
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] font-black">
                    <AlertTriangle size={10} /> {warnCount}
                  </span>
                )}
                {infoCount > 0 && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[11px] font-black">
                    <Info size={10} /> {infoCount}
                  </span>
                )}
              </>
            )}
            {report.aiChecked && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black">AI</span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={onViewResult}
            title="Xem biên bản"
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Eye size={14} />
          </button>
          {result.fileUrl && (
            <a
              href={result.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Mở ảnh gốc"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <ExternalLink size={14} />
            </a>
          )}
          {hasImage && report && !report.aiChecked && (
            <button
              onClick={onRunAi}
              disabled={isRunningAi}
              title="Gửi AI kiểm tra lại"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 transition-colors"
            >
              {isRunningAi ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
              AI
            </button>
          )}
        </div>

        {report && totalIssues > 0 && (
          <div className="flex-shrink-0 text-slate-400">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        )}
      </div>

      {/* Issues list */}
      {expanded && report && totalIssues > 0 && (
        <div className="border-t border-slate-200 divide-y divide-slate-100">
          {report.issues.map((issue, i) => (
            <div key={i} className={`px-4 py-2.5 text-xs ${
              issue.severity === 'error' ? 'bg-red-50/60' :
              issue.severity === 'warning' ? 'bg-amber-50/60' : 'bg-blue-50/40'
            }`}>
              <div className="flex items-start gap-2 flex-wrap">
                <SeverityBadge severity={issue.severity} />
                <TypeBadge type={issue.type} />
                <span className="font-black text-slate-700">{issue.field}</span>
                {issue.layerIndex >= 0 && (
                  <span className="text-slate-500">Lớp {issue.layerIndex + 1}</span>
                )}
              </div>
              <p className="mt-1 text-slate-600">{issue.message}</p>
              {(issue.expected || issue.actual) && (
                <div className="mt-1 flex items-center gap-3 text-[11px]">
                  {issue.expected && (
                    <span className="text-emerald-700">
                      <span className="font-bold">Đúng: </span>{issue.expected}
                    </span>
                  )}
                  {issue.actual && (
                    <span className="text-red-700">
                      <span className="font-bold">Trích xuất: </span>{issue.actual}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main ValidationPanel component
// ─────────────────────────────────────────────
export function ValidationPanel({
  history,
  onSelectResult,
  onEdit,
  apiKey,
}: {
  history: ExtractionResult[];
  onSelectResult: (res: ExtractionResult) => void;
  onEdit: (res: ExtractionResult) => void;
  apiKey: string;
}) {
  const [reports, setReports] = useState<Record<string, ValidationReport>>({});
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runningAiIds, setRunningAiIds] = useState<Set<string>>(new Set());
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'error' | 'warning' | 'clean'>('all');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const projects = useMemo(() =>
    ['all', ...Array.from(new Set(history.map(r => r.project).filter(Boolean)))],
    [history]
  );

  const filteredHistory = useMemo(() => {
    return history.filter(r => {
      if (filterProject !== 'all' && r.project !== filterProject) return false;
      if (filterSeverity === 'all') return true;
      const report = reports[r.id];
      if (!report) return false;
      const errors = report.issues.filter(i => i.severity === 'error').length;
      const warns = report.issues.filter(i => i.severity === 'warning').length;
      if (filterSeverity === 'error') return errors > 0;
      if (filterSeverity === 'warning') return warns > 0 && errors === 0;
      if (filterSeverity === 'clean') return report.issues.length === 0;
      return true;
    });
  }, [history, reports, filterProject, filterSeverity]);

  // Stats
  const stats = useMemo(() => {
    const checked = Object.values(reports);
    const total = history.length;
    const withErrors = checked.filter(r => r.issues.some(i => i.severity === 'error')).length;
    const withWarnings = checked.filter(r => r.issues.some(i => i.severity === 'warning') && !r.issues.some(i => i.severity === 'error')).length;
    const clean = checked.filter(r => r.issues.length === 0).length;
    const unchecked = total - checked.length;
    return { total, withErrors, withWarnings, clean, unchecked, checked: checked.length };
  }, [history, reports]);

  // Run rule engine for one result
  const runRules = useCallback((result: ExtractionResult) => {
    const issues = runRuleEngine(result);
    setReports(prev => ({
      ...prev,
      [result.id]: {
        resultId: result.id,
        pileId: result.pileId,
        project: result.project,
        fileName: result.fileName,
        fileUrl: result.fileUrl,
        issues,
        aiChecked: false,
        checkedAt: Date.now(),
      },
    }));
  }, []);

  // Run all
  const runAllRules = useCallback(async () => {
    setIsRunningAll(true);
    setProgress({ current: 0, total: history.length });
    for (let i = 0; i < history.length; i++) {
      runRules(history[i]);
      setProgress({ current: i + 1, total: history.length });
      await new Promise(r => setTimeout(r, 10)); // yield to UI
    }
    setIsRunningAll(false);
  }, [history, runRules]);

  // Run AI cross-check for one result
  const runAiCheck = useCallback(async (result: ExtractionResult) => {
    if (!apiKey) { alert('Chưa có API Key Gemini. Vui lòng cấu hình trong Cài đặt.'); return; }
    const existingReport = reports[result.id];
    const suspiciousLayers = (existingReport?.issues || [])
      .filter(i => i.severity === 'error' || i.type === 'outlier')
      .map(i => i.layerIndex)
      .filter((v, i, a) => a.indexOf(v) === i);

    setRunningAiIds(prev => new Set(prev).add(result.id));
    try {
      const { issues: aiIssues, raw } = await runAiCrossCheck(result, apiKey, suspiciousLayers);
      setReports(prev => {
        const existing = prev[result.id];
        // Merge: keep rule issues, add AI issues (deduplicate by field+layer)
        const existingIssues = existing?.issues || [];
        const merged = [...existingIssues];
        for (const ai of aiIssues) {
          const dup = merged.find(e => e.layerIndex === ai.layerIndex && e.field === ai.field && e.type === 'ai_flag');
          if (!dup) merged.push(ai);
        }
        return {
          ...prev,
          [result.id]: {
            ...(existing || {
              resultId: result.id,
              pileId: result.pileId,
              project: result.project,
              fileName: result.fileName,
              fileUrl: result.fileUrl,
              checkedAt: Date.now(),
            }),
            issues: merged,
            aiChecked: true,
            aiRawResponse: raw,
            checkedAt: Date.now(),
          },
        };
      });
    } catch (err: any) {
      alert(`Lỗi AI: ${err?.message || err}`);
    } finally {
      setRunningAiIds(prev => { const s = new Set(prev); s.delete(result.id); return s; });
    }
  }, [apiKey, reports]);

  const checkedCount = Object.keys(reports).length;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-red-500 rounded-full" />
          <div>
            <h3 className="text-[18px] font-black text-black uppercase tracking-tight">Kiểm tra dữ liệu</h3>
            <p className="text-xs text-slate-500 font-medium">Phát hiện lỗi trích xuất — không tự động sửa</p>
          </div>
        </div>
        <button
          onClick={runAllRules}
          disabled={isRunningAll || history.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm"
        >
          {isRunningAll
            ? <><Loader2 size={14} className="animate-spin" /> Đang kiểm tra {progress.current}/{progress.total}...</>
            : <><RefreshCw size={14} /> Kiểm tra tất cả ({history.length})</>
          }
        </button>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Tổng biên bản', value: stats.total, color: 'bg-slate-600', textColor: 'text-slate-600' },
          { label: 'Đã kiểm tra', value: stats.checked, color: 'bg-blue-500', textColor: 'text-blue-600' },
          { label: 'Có lỗi', value: stats.withErrors, color: 'bg-red-500', textColor: 'text-red-600' },
          { label: 'Cảnh báo', value: stats.withWarnings, color: 'bg-amber-500', textColor: 'text-amber-600' },
          { label: 'Đạt chuẩn', value: stats.clean, color: 'bg-emerald-500', textColor: 'text-emerald-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className={`text-2xl font-black ${s.textColor}`}>{s.value}</div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Chú thích cách hoạt động ── */}
      {checkedCount === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-black mb-1 flex items-center gap-2"><Info size={14} /> Cách hoạt động</p>
          <ul className="space-y-1 text-xs text-blue-700 list-disc list-inside">
            <li><span className="font-bold">Kiểm tra tất cả</span> — Rule engine chạy ngay, kiểm tra toán học: T.GIAN, DÀI, V(m/h), tính liên tục cao độ và giờ</li>
            <li><span className="font-bold">Nút AI</span> (từng biên bản) — Gửi ảnh gốc lên Gemini để đọc lại độc lập, phát hiện lỗi nhận dạng chữ viết tay</li>
            <li><span className="font-black text-red-700">Không tự động sửa</span> — Chỉ hiển thị lỗi, bạn quyết định sửa</li>
          </ul>
        </div>
      )}

      {/* ── Filters ── */}
      {checkedCount > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-xs font-bold text-slate-500 uppercase tracking-wide">
            <Filter size={12} /> Lọc:
          </div>
          {[
            { key: 'all', label: 'Tất cả' },
            { key: 'error', label: 'Có lỗi' },
            { key: 'warning', label: 'Cảnh báo' },
            { key: 'clean', label: 'Đạt chuẩn' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilterSeverity(f.key as any)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                filterSeverity === f.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}

          {projects.length > 2 && (
            <select
              value={filterProject}
              onChange={e => setFilterProject(e.target.value)}
              className="text-[11px] font-bold bg-slate-100 border-0 text-slate-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer"
            >
              {projects.map(p => (
                <option key={p} value={p}>{p === 'all' ? 'Tất cả dự án' : p}</option>
              ))}
            </select>
          )}

          <span className="text-xs text-slate-400 ml-auto">{filteredHistory.length} biên bản</span>
        </div>
      )}

      {/* ── Results list ── */}
      <div className="space-y-2">
        {filteredHistory.length === 0 && checkedCount > 0 && (
          <div className="text-center py-10 text-slate-400 text-sm">Không có biên bản nào khớp bộ lọc</div>
        )}
        {filteredHistory.map(result => (
          <ValidationRow
            key={result.id}
            result={result}
            report={reports[result.id]}
            isRunningAi={runningAiIds.has(result.id)}
            onRunAi={() => runAiCheck(result)}
            onViewResult={() => onEdit(result)}
          />
        ))}
      </div>

      {/* ── AI batch note ── */}
      {checkedCount > 0 && stats.withErrors + stats.withWarnings > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-xs text-purple-800">
          <p className="font-black mb-1 flex items-center gap-2">
            <ShieldCheck size={13} /> Muốn dùng AI kiểm tra chuyên sâu hơn?
          </p>
          <p>Nhấn nút <span className="font-black bg-purple-100 px-1.5 py-0.5 rounded">AI</span> ở từng biên bản nghi ngờ để gửi ảnh gốc lên Gemini đọc lại độc lập. Cần có ảnh gốc đã upload.</p>
        </div>
      )}
    </div>
  );
}
