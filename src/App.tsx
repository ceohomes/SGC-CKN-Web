import React, { useState, useRef, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { 
  Upload, 
  FileText, 
  BarChart3, 
  Table as TableIcon, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Construction,
  ChevronRight,
  ChevronLeft,
  ArrowDownToLine,
  Activity,
  Calendar,
  Layers,
  Menu,
  Plus,
  Database,
  History,
  X,
  Settings,
  Save,
  RefreshCw,
  Key,
  RotateCcw,
  ImageIcon,
  Trash2,
  ExternalLink,
  Cloud,
  Github,
  Edit2,
  Maximize2,
  Minimize2,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  BarChart2,
  Building2,
  TrendingUp,
  PieChart as PieChartIcon,
  Scissors,
  Filter,
  Search,
  ChevronDown,
  RotateCw,
  FileDown,
  ArrowRight,
  Sparkles,
  CircleDot
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  LabelList,
  LineChart,
  Line,
  PieChart,
  Pie,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './supabase';
import { Document, Page, pdfjs } from 'react-pdf';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version || '4.4.168'}/build/pdf.worker.min.mjs`;

// Helper: Chuyển đổi PDF sang mảng ảnh (JPEG) để trích xuất dữ liệu đa trang
const convertPdfToImages = async (data: ArrayBuffer | Blob | File | string): Promise<string[]> => {
  try {
    let arrayBuffer: ArrayBuffer;
    if (typeof data === 'string') {
      const base64 = data.includes(',') ? data.split(',')[1] : data;
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      arrayBuffer = bytes.buffer;
    } else if (data instanceof ArrayBuffer) {
      arrayBuffer = data;
    } else {
      arrayBuffer = await data.arrayBuffer();
    }

    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const images: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      if (context) {
        await (page as any).render({ canvasContext: context, viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.8));
      }
    }
    
    if (images.length === 0) throw new Error("Không thể trích xuất ảnh từ PDF");
    return images;
  } catch (err) {
    console.error("PDF to Image conversion error:", err);
    throw err;
  }
};

// Helper: Chuyển đổi PDF sang ảnh (JPEG) - chỉ lấy trang đầu tiên (cho Excel/Preview)
const convertPdfToImage = async (data: ArrayBuffer | Blob | File | string): Promise<string> => {
  const images = await convertPdfToImages(data);
  return images[0];
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper: Lấy giá trị hiển thị cho cột "Địa chất thực tế"
// Loại A: actualGeology là số (1,2,3) → hiển thị số đó
// Loại B: actualGeology là chữ dài → hiển thị designLayerCode (STT tự đánh)
function getGeoDisplay(layer: { actualGeology?: string; designLayerCode?: string }): string {
  const geo = (layer.actualGeology || '').trim();
  const code = (layer.designLayerCode || '').trim();
  if (/^\d+$/.test(geo)) return geo;
  if (code) return code;
  return geo;
}

// ── Bỏ số thứ tự ở đầu chuỗi mô tả lớp địa chất ──
// VD: "2.Sét pha, xám nâu..."  → "Sét pha, xám nâu..."
//     "11.Sét xám vàng..."     → "Sét xám vàng..."
//     "3.Sét lẫn hữu cơ..."   → "Sét lẫn hữu cơ..."
//     "Đất Lấp"               → "Đất Lấp"  (giữ nguyên nếu không có số đầu)
function stripLayerPrefix(desc: string): string {
  if (!desc) return desc;
  // Khớp: số (1 hoặc nhiều chữ số) theo sau là dấu chấm/gạch/ngoặc rồi khoảng trắng tuỳ ý
  // VD: "2.", "11.", "2. ", "2 - ", "2) "
  return desc.replace(/^\d+[\.\-\)]\s*/, '').trim();
}

// ── Ép kiểu an toàn về number — tránh lỗi "toFixed is not a function" ──
// Supabase/localStorage đôi khi trả về số dưới dạng string
function toNum(val: any, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? fallback : n;
}

// ── Chuẩn hóa toàn bộ fields số trong 1 layer — gọi khi load từ DB/localStorage ──
function sanitizeLayer(layer: any): any {
  if (!layer) return layer;
  return {
    ...layer,
    elevationFrom:  toNum(layer.elevationFrom,  0),
    elevationTo:    toNum(layer.elevationTo,     0),
    durationHours:  toNum(layer.durationHours,   0),
    lengthMeters:   toNum(layer.lengthMeters,    0),
    cumulativeDepth: toNum(layer.cumulativeDepth, 0),
    speedMph:       toNum(layer.speedMph,        0),
    layerNumber:    toNum(layer.layerNumber,     0),
    soilClass:      (['Chưa Phân định nhóm','Đất cấp I','Đất cấp II','Đất cấp III','Đá cấp I'].includes(layer.soilClass) ? layer.soilClass : 'Chưa Phân định nhóm'),
  };
}

// --- Types ---

interface DrillLayer {
  project: string;
  item: string;
  componentName: string;
  pileId: string;
  reportNumber: string;
  diameter: string;
  constructionStart: string;
  constructionEnd: string;
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
  cumulativeDepth: number;
  speedMph: number;
  soilClass?: string;
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
  stt?: number;       // Số thứ tự từ Supabase
  excelUrl?: string;  // URL file Excel đã tạo và upload GitHub
  _base64?: string;   // Tạm lưu để upload GitHub khi xác nhận
  _mimeType?: string;
  designLayerMap?: Record<string, string>; // Bảng tra cứu lớp địa chất
  casingElevation?: number | null; // Cao độ đỉnh casing (m) — dùng để tính cao độ tuyệt đối cho Loại B
}

const SOIL_CLASSES = [
  'Chưa Phân định nhóm',
  'Đất cấp I',
  'Đất cấp II',
  'Đất cấp III',
  'Đá cấp I'
];

const GROUP_COLORS = [
  { bg: 'BFDFFF', font: '0D3B6E' },{ bg: 'FDE68A', font: '78350F' },
  { bg: 'A7F3D0', font: '065F46' },{ bg: 'FECACA', font: '7F1D1D' },
  { bg: 'DDD6FE', font: '4C1D95' },{ bg: 'D9F99D', font: '365314' },
  { bg: 'FED7AA', font: '7C2D12' },{ bg: 'A5F3FC', font: '164E63' },
  { bg: 'FBCFE8', font: '831843' },{ bg: '99F6E4', font: '134E4A' },
  { bg: 'FECACA', font: '7F1D1D' },{ bg: 'C7D2FE', font: '312E81' },
];

const loadExcelJS = (): Promise<any> => new Promise((resolve, reject) => {
  if ((window as any).ExcelJS) { resolve((window as any).ExcelJS); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  s.onload = () => { resolve((window as any).ExcelJS); };
  s.onerror = () => reject(new Error('Không tải được ExcelJS'));
  document.head.appendChild(s);
});

const prepareFile = async (file: File): Promise<{ images: { base64: string; mimeType: string }[]; fileName: string }> => {
  const getBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader(); r.readAsDataURL(f);
    r.onload = () => res(r.result as string); r.onerror = rej;
  });

  const compressImage = async (f: File): Promise<string> => {
    try {
      const bitmap = await createImageBitmap(f);
      const MAX = 2000;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.readAsDataURL(f);
        reader.onload = (ev) => {
          const img = new Image();
          img.src = ev.target?.result as string;
          img.onload = () => {
            const MAX = 2000;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
            res(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.onerror = rej;
        };
        reader.onerror = rej;
      });
    }
  };

  if (file.type === 'application/pdf') {
    try {
      const images = await convertPdfToImages(file);
      return { 
        images: images.map(b => ({ base64: b, mimeType: 'image/jpeg' })), 
        fileName: file.name.replace(/\.[^/.]+$/, '') + '.jpg' 
      };
    } catch {
      return { 
        images: [{ base64: await getBase64(file), mimeType: 'application/pdf' }], 
        fileName: file.name 
      };
    }
  } else if (file.type.startsWith('image/')) {
    return { 
      images: [{ base64: await compressImage(file), mimeType: 'image/jpeg' }], 
      fileName: file.name 
    };
  }
  throw new Error('Định dạng tệp không được hỗ trợ. Vui lòng sử dụng ảnh hoặc PDF.');
};

const buildExcelFileName = (result: ExtractionResult): string => {
  const endDateRaw = result.constructionEnd || '';
  const endDatePart = endDateRaw.includes(' ') ? endDateRaw.split(' ').slice(-1)[0] : endDateRaw;
  const endDateForName = endDatePart.replace(/\//g, '-'); // DD-MM-YYYY
  return [
    result.componentName || 'BienBan',
    result.pileId || '',
    result.diameter || '',
    endDateForName || '',
  ].filter(Boolean).join('_').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9À-ɏḀ-ỿ_\-]/g, '_');
};

interface ProcessingFile {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  result?: ExtractionResult;
  error?: string;
}

type AppSheet = 'upload' | 'summary' | 'pdf-splitter' | 'geology';

// --- Helper Functions ---

// Chuẩn hóa chuỗi ngày giờ bất kỳ → "HH:mm DD/MM/YYYY"
const normalizeDateTime = (raw: string): string => {
  if (!raw) return '';
  const s = raw.trim();

  // Tách phần giờ (HH:mm hoặc HH:MMh hoặc HHhMM)
  const timeMatch = s.match(/(\d{1,2})[h:](\d{2})/i);
  const hh = timeMatch ? timeMatch[1].padStart(2, '0') : '';
  const mm = timeMatch ? timeMatch[2].padStart(2, '0') : '';

  // Tách phần ngày – ưu tiên DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  let day = '', month = '', year = '';
  const dmyMatch = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  const ymdMatch = s.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  
  if (dmyMatch) {
    day   = dmyMatch[1].padStart(2, '0');
    month = dmyMatch[2].padStart(2, '0');
    year  = dmyMatch[3];
    if (year.length === 2) year = '20' + year;
  } else if (ymdMatch) {
    year  = ymdMatch[1];
    month = ymdMatch[2].padStart(2, '0');
    day   = ymdMatch[3].padStart(2, '0');
  } else {
    // Thử lấy 8 chữ số liền nhau: DDMMYYYY
    const compact = s.match(/(\d{8})/);
    if (compact) {
      day   = compact[1].slice(0, 2);
      month = compact[1].slice(2, 4);
      year  = compact[1].slice(4, 8);
    } else {
      // Thử lấy 6 chữ số: DDMMYY
      const compact6 = s.match(/(\d{6})/);
      if (compact6) {
        day   = compact6[1].slice(0, 2);
        month = compact6[1].slice(2, 4);
        year  = '20' + compact6[1].slice(4, 6);
      }
    }
  }

  const timePart  = hh && mm ? `${hh}:${mm}` : '';
  const datePart  = day && month && year ? `${day}/${month}/${year}` : '';

  if (timePart && datePart) return `${timePart} ${datePart}`;
  if (timePart) return timePart;
  if (datePart) return datePart;
  return s; // giữ nguyên nếu không parse được
};

// Định dạng số: thập phân là dấu phẩy, hàng nghìn là dấu chấm (kiểu Việt Nam)
const formatNumber = (num: number | string | undefined | null, decimals: number = 2): string => {
  if (num === undefined || num === null) return '—';
  const val = typeof num === 'string' ? parseFloat(num.replace(',', '.')) : num;
  if (isNaN(val)) return '—';
  
  // Manually format to ensure comma decimal separator and dot thousands separator
  const fixed = val.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart ? `${formattedInt},${decPart}` : formattedInt;
};

// Tính thời gian thi công (giờ) từ constructionStart đến constructionEnd
// Định dạng: "HH:mm DD/MM/YYYY" hoặc "DD/MM/YYYY HH:mm" hoặc "DD/MM/YYYY"
const calcConstructionDurationHours = (start: string, end: string): number => {
  if (!start || !end) return 0;
  const parseDateTime = (s: string): Date | null => {
    if (!s) return null;
    const trimmed = s.trim();
    
    // 1. HH:mm DD/MM/YYYY
    const m1 = trimmed.match(/(\d{1,2})[:h](\d{2})\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i);
    if (m1) return new Date(parseInt(m1[5]), parseInt(m1[4]) - 1, parseInt(m1[3]), parseInt(m1[1]), parseInt(m1[2]));
    
    // 2. DD/MM/YYYY HH:mm
    const m2 = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2})[:h](\d{2})/i);
    if (m2) return new Date(parseInt(m2[3]), parseInt(m2[2]) - 1, parseInt(m2[1]), parseInt(m2[4]), parseInt(m2[5]));

    // 3. DD/MM/YYYY
    const m3 = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m3) return new Date(parseInt(m3[3]), parseInt(m3[2]) - 1, parseInt(m3[1]), 0, 0);

    return null;
  };
  const d1 = parseDateTime(start);
  const d2 = parseDateTime(end);
  if (!d1 || !d2) return 0;
  const diff = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60);
  return diff > 0 ? diff : 0;
};

const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  let cleanTime = timeStr.toLowerCase()
    .replace('h', ':')
    .split(' ')[0]
    .trim();
    
  const parts = cleanTime.split(':');
  if (parts.length < 2) return 0;
  
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
};

const parseDateTimeToMinutes = (timeStr: string, dateStr: string): number => {
  if (!timeStr || !dateStr) return 0;
  
  // Parse time
  let cleanTime = timeStr.toLowerCase().replace('h', ':').split(' ')[0].trim();
  const timeParts = cleanTime.split(':');
  if (timeParts.length < 2) return 0;
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  
  // Parse date (DD/MM/YYYY)
  const dateParts = dateStr.split('/');
  if (dateParts.length < 3) return 0;
  const day = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1;
  const year = parseInt(dateParts[2], 10);
  
  if (isNaN(hours) || isNaN(minutes) || isNaN(day) || isNaN(month) || isNaN(year)) return 0;
  
  const dateObj = new Date(year, month, day, hours, minutes);
  return Math.floor(dateObj.getTime() / (1000 * 60));
};

// Component Textarea tự động giãn dòng
const AutoResizeTextarea = ({ value, onChange, className, placeholder, style, ...props }: any) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => {
        onChange(e);
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
      }}
      className={className}
      placeholder={placeholder}
      rows={1}
      style={{ ...style, height: 'auto' }}
      {...props}
    />
  );
};

// Component Input số hỗ trợ dấu phẩy và local state để tránh lỗi hook trong loop
const NumericCell = ({ value, onChange, className, style }: { value: any, onChange: (val: number) => void, className?: string, style?: React.CSSProperties }) => {
  const format = (v: any) => {
    const n = toNum(v);
    return n.toFixed(2).replace('.', ',');
  };

  const [localVal, setLocalVal] = React.useState(format(value));
  
  React.useEffect(() => {
    setLocalVal(format(value));
  }, [value]);

  return (
    <input
      type="text"
      value={localVal}
      onChange={(e) => {
        const raw = e.target.value;
        setLocalVal(raw);
        const parsed = parseFloat(raw.replace(',', '.'));
        if (!isNaN(parsed)) onChange(parsed);
      }}
      onBlur={(e) => {
        const parsed = parseFloat(e.target.value.replace(',', '.'));
        if (!isNaN(parsed)) {
          onChange(parsed);
          setLocalVal(format(parsed));
        } else {
          setLocalVal(format(value));
        }
      }}
      className={className}
      style={style}
    />
  );
};

// --- Gemini Service ---

// Kiểm tra lỗi quota/rate-limit từ Gemini
const isQuotaError = (err: any): boolean => {
  const msg = (err?.message || err?.toString() || '').toLowerCase();
  return (
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('ratelimitexceeded') ||
    (err?.status === 429) ||
    (err?.code === 429)
  );
};

const extractDataFromFile = async (images: { base64: string; mimeType: string }[], userApiKey?: string): Promise<Omit<ExtractionResult, 'id' | 'timestamp'>> => {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key không tồn tại. Vui lòng cấu hình trong phần Cài đặt.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentFormattedDate = `${currentDate.getDate().toString().padStart(2, '0')}/${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentYear}`;

  const imageParts = images.map(img => {
    const data = img.base64.split(',')[1];
    return {
      inlineData: {
        data,
        mimeType: img.mimeType
      }
    };
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          ...imageParts,
          {
            text: `Bạn là một chuyên gia phân tích dữ liệu xây dựng cao cấp, chuyên về hồ sơ địa chất và khoan cọc nhồi. 
Nhiệm vụ của bạn là trích xuất dữ liệu từ ${images.length} hình ảnh/trang PDF biên bản khoan cọc nhồi với độ chính xác tuyệt đối 100%.

════════════════════════════════════════════════════
QUY TẮC TỔNG QUÁT:
1. TỔNG HỢP ĐA TRANG: Kết hợp dữ liệu từ TẤT CẢ các trang. Nếu bảng kéo dài qua nhiều trang, hãy nối các dòng lại theo đúng thứ tự thời gian và độ sâu.
2. KHÔNG HỎI LẠI: Trả về kết quả dưới dạng JSON duy nhất, không có văn bản giải thích bên ngoài.
3. XỬ LÝ CHỮ VIẾT TAY: Đây là dữ liệu viết tay, hãy cực kỳ cẩn thận với các con số dễ nhầm lẫn (0/1, 1/7, 4/9, 5/8, 2/7).
4. TÍNH LOGIC: Dữ liệu phải tăng dần về thời gian và độ sâu. Nếu có mâu thuẫn, hãy ưu tiên con số rõ nét nhất và ghi chú vào trường "notes".

════════════════════════════════════════════════════
BƯỚC 0: PHÂN LOẠI BIÊN BẢN (CỰC KỲ QUAN TRỌNG)
════════════════════════════════════════════════════
Dựa vào tiêu đề và cấu trúc để xác định loại:

▶ LOẠI A (Biên bản theo dõi địa chất):
  - Có bảng tra cứu "Căn cứ Hồ sơ BVBPCT" (liệt kê Lớp 1, 2, 3... kèm mô tả thiết kế).
  - Cột "Địa chất thực tế" ghi SỐ (1, 2, 3...).
  - Cột "Cao độ" ghi số ÂM (ví dụ: -15.50).

▶ LOẠI B (Biên bản kiểm tra công tác khoan):
  - Tiêu đề: "KIỂM TRA CÔNG TÁC KHOAN TẠO LỖ...".
  - Cột "Địa chất thực tế" ghi MÔ TẢ CHỮ (ví dụ: "Sét pha xám vàng...").
  - Cột "Độ sâu (từ đỉnh casing)" có 2 số: Số nhỏ (Chiều dài lớp) và Số lớn (Tích lũy/Cộng dồn).
  - Có trường "Cao độ đỉnh casing" ở header.

════════════════════════════════════════════════════
BƯỚC 1: TRÍCH XUẤT HEADER (THÔNG TIN CHUNG)
════════════════════════════════════════════════════
- project: Tên dự án/công trình.
- item: Hạng mục (PHẢI lấy đúng dòng "Hạng mục", không lấy nhầm "Dự án").
- pileId: Số hiệu cọc (ví dụ: "C9", "17-05").
- reportNumber: Tên máy khoan (Drilling Machine). Ví dụ: "SANY 285", "XCMG 360", "Bauer BG28". Đọc từ header biên bản.
- diameter: Đường kính cọc (ví dụ: "D800", "1200").
- constructionStart / constructionEnd: Thời gian bắt đầu/kết thúc tổng thể (HH:mm DD/MM/YYYY).
- casingElevation: Cao độ đỉnh casing (chỉ có ở Loại B). Đọc số viết tay (ví dụ: "0,71").

════════════════════════════════════════════════════
BƯỚC 2: CHI TIẾT CÁC LỚP ĐỊA TẦNG
════════════════════════════════════════════════════

--- ĐỐI VỚI LOẠI A ---
- actualGeology: Lấy SỐ hiệu lớp (1, 2, 3...).
- designLayerCode: Giống actualGeology.
- layerDesign: Tra cứu mô tả từ bảng "Căn cứ Hồ sơ..." tương ứng với số hiệu.
- elevationFrom / elevationTo: Lấy số ÂM trong bảng.

--- ĐỐI VỚI LOẠI B ---
- actualGeology: Lấy MÔ TẢ CHỮ đầy đủ (ví dụ: "Sét pha xám vàng...").
- designLayerCode: Tự đánh số 1, 2, 3... cho từng dòng từ trên xuống.
- layerDesign: Giống actualGeology.
- lengthMeters: Số nhỏ trong cột "Độ sâu (từ đỉnh casing)".
- cumulativeDepth: Số lớn trong cột "Độ sâu (từ đỉnh casing)".
- elevationFrom: -(Số tích lũy của lớp TRƯỚC). Lớp đầu tiên = -(casingElevation).
- elevationTo: -(cumulativeDepth của lớp hiện tại).
  *Lưu ý: Tất cả cao độ Loại B phải là số ÂM.*

════════════════════════════════════════════════════
BƯỚC 3: XỬ LÝ THỜI GIAN (KIỂM TRA 3 LẦN)
════════════════════════════════════════════════════
- Định dạng: HH:mm (ví dụ: 17:20).
- ⚠️ CẢNH BÁO: Chữ viết tay số "1" đầu giờ thường rất mảnh, dễ bị đọc sót (ví dụ: "17h20" đọc thành "7h20"). 
- QUY TẮC: Nếu giờ trích xuất là 0-9h, hãy nhìn kỹ xem có nét gạch dọc của số "1" phía trước không.
- Thời gian phải TĂNG DẦN. Nếu dòng trước kết thúc 16:57, dòng sau bắt đầu 7:20 -> Chắc chắn là 17:20.

════════════════════════════════════════════════════
BƯỚC 4: TỰ KIỂM TRA & XÁC THỰC (SELF-VALIDATION)
════════════════════════════════════════════════════
Trước khi xuất JSON, hãy tự kiểm tra các điều kiện sau:
1. [Toán học Loại B]: (Tích lũy dòng trước) + (Chiều dài dòng này) = (Tích lũy dòng này)? 
   Nếu sai lệch > 0.05m, hãy xem lại ảnh để tìm chữ số bị đọc nhầm (thường là nhầm 1/2 hoặc 2/7).
2. [Thời gian]: Có dòng nào thời gian bị lùi lại không? (Ví dụ: 15:00 -> 14:30). Nếu có, hãy kiểm tra lại số "1" bị sót hoặc nhầm 3/5.
3. [Cao độ]: Các lớp có liên tục không? (elevationTo lớp N = elevationFrom lớp N+1).
4. [Chữ viết tay]: Tôi có đang nhầm "0,71" thành "-0,71" ở header không? (Chỉ lấy số dương nếu văn bản ghi dương).
5. [Địa chất]: Tôi có đang lấy nhầm "Địa chất thiết kế" vào cột "Địa chất thực tế" không?

Nếu phát hiện mâu thuẫn không thể giải quyết, hãy ghi chú chi tiết vào trường "notes" của lớp đó.`
          },
        ]
      }
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          project: { type: Type.STRING },
          item: { type: Type.STRING },
          componentName: { type: Type.STRING },
          pileId: { type: Type.STRING },
          reportNumber: { type: Type.STRING, description: "Tên máy khoan (Drilling Machine)" },
          diameter: { type: Type.STRING },
          constructionStart: { type: Type.STRING },
          constructionEnd: { type: Type.STRING },
          designLayerMap: {
            type: Type.OBJECT,
            description: "Bảng tra cứu: key = designLayerCode (\"1\",\"2\"...), value = mô tả địa chất thiết kế"
          },
          layers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                layerNumber: { type: Type.INTEGER },
                designLayerCode: { type: Type.STRING },
                layerDesign: { type: Type.STRING },
                timeFrom: { type: Type.STRING },
                timeTo: { type: Type.STRING },
                dateFrom: { type: Type.STRING },
                dateTo: { type: Type.STRING },
                elevationFrom: { type: Type.NUMBER, description: "Loại B: Tích lũy ĐẦU lớp (số LỚN). Loại A: Cao độ ĐẦU lớp (số ÂM)." },
                elevationTo: { type: Type.NUMBER, description: "Loại B: Tích lũy CUỐI lớp (số LỚN). Loại A: Cao độ CUỐI lớp (số ÂM)." },
                lengthMeters: { type: Type.NUMBER, description: "Chiều dài lớp (m). Đọc từ cột 'Chiều dài' (Loại B) hoặc tự tính (Loại A). VD: 1,6 hoặc 10,2." },
                cumulativeDepth: { type: Type.NUMBER, description: "Loại B: Số LỚN (tích lũy từ đỉnh casing đến cuối lớp này). VD: 2,78 hoặc 12,96. Loại A: để 0." },
                actualGeology: { type: Type.STRING, description: "Số hiệu lớp địa chất thực tế (ví dụ: \"1\", \"2\"). Tuyệt đối không lấy mô tả chữ." },
                notes: { type: Type.STRING, description: "Ghi chú cho lớp địa chất này (nếu có)" }
              },
              required: ["layerNumber", "designLayerCode", "layerDesign", "timeFrom", "timeTo", "dateFrom", "dateTo", "elevationFrom", "elevationTo", "actualGeology"]
            }
          },
          notes: { type: Type.STRING, description: "Ghi chú tổng hợp cho toàn bộ biên bản" },
          casingElevation: { type: Type.NUMBER, description: "Cao độ đỉnh casing (m) — đọc NGUYÊN GIÁ TRỊ từ header. VD: 0.71 nếu biên bản ghi 0,71. Không thêm dấu âm. Null nếu Loại A." }
        },
        required: ["project", "item", "componentName", "pileId", "reportNumber", "diameter", "constructionStart", "constructionEnd", "layers"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("Không có phản hồi từ AI");
  const rawData = JSON.parse(text);

  // Post-process: đảm bảo layerDesign nhất quán theo actualGeology (VLOOKUP logic)
  // Ưu tiên 1: designLayerMap do AI trích xuất từ bảng tra cứu "Căn cứ Hồ sơ..."
  const vlookupMap: Record<string, string> = {};
  if (rawData.designLayerMap && typeof rawData.designLayerMap === 'object') {
    Object.entries(rawData.designLayerMap).forEach(([code, desc]) => {
      if (code && desc) {
        // ⭐ Bỏ số thứ tự đầu mô tả trong designLayerMap (VD: "2.Sét pha..." → "Sét pha...")
        vlookupMap[code.toString().trim()] = stripLayerPrefix(desc as string);
      }
    });
  }

  // ── AUTO-FIX: Sửa lỗi AI đọc sót chữ số "1" đầu trong giờ viết tay ──
  // Ví dụ: "7h20" khi dòng trước kết thúc lúc "16h57" → phải là "17h20"
  const fixDroppedHourDigit = (layers: any[]): any[] => {
    if (!layers || layers.length === 0) return layers;
    const parseH = (t: string) => {
      if (!t) return -1;
      const m = t.match(/^(\d{1,2})[h:](\d{2})/);
      return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : -1;
    };
    const addLeading1 = (t: string) => t.replace(/^(\d)[h:]/, '1$1h');

    return layers.map((layer, i) => {
      let { timeFrom, timeTo } = layer;
      // Lấy giờ kết thúc của dòng trước để so sánh
      const prevEndTime = i > 0 ? layers[i - 1].timeTo : null;
      const prevEndMin = prevEndTime ? parseH(prevEndTime) : -1;

      // Kiểm tra timeFrom: nếu giờ 1 chữ số VÀ dòng trước kết thúc > 9h so với timeFrom hiện tại
      if (timeFrom && /^[2-9][h:]/.test(timeFrom)) {
        const curMin = parseH(timeFrom);
        // Nếu dòng trước kết thúc lúc > curMin + 60 → nhiều khả năng bị sót "1"
        if (prevEndMin > 0 && prevEndMin > curMin + 60) {
          const fixed = addLeading1(timeFrom);
          const fixedMin = parseH(fixed);
          // Chỉ sửa nếu sau khi thêm "1" thì hợp lý hơn (gần với prevEndMin)
          if (fixedMin >= prevEndMin - 30 && fixedMin <= prevEndMin + 120) {
            console.warn(`[AutoFix] timeFrom sót "1": "\${timeFrom}" → "\${fixed}" (dòng \${i + 1})`);
            timeFrom = fixed;
          }
        }
      }

      // Kiểm tra timeTo: nếu giờ 1 chữ số VÀ nhỏ hơn timeFrom nhiều
      if (timeTo && /^[2-9][h:]/.test(timeTo)) {
        const fromMin = parseH(timeFrom);
        const toMin = parseH(timeTo);
        if (fromMin > 0 && fromMin > toMin + 60) {
          const fixed = addLeading1(timeTo);
          const fixedMin = parseH(fixed);
          if (fixedMin > fromMin && fixedMin <= fromMin + 180) {
            console.warn(`[AutoFix] timeTo sót "1": "\${timeTo}" → "\${fixed}" (dòng \${i + 1})`);
            timeTo = fixed;
          }
        }
      }

      return { ...layer, timeFrom, timeTo };
    });
  };

  // Phát hiện Loại B: designLayerMap rỗng VÀ actualGeology lớp đầu là chữ (không phải số thuần)
  const hasVlookupMap = Object.keys(vlookupMap).length > 0;
  const firstLayerGeo = (rawData.layers?.[0]?.actualGeology || '').toString().trim();
  const isTypeB = !hasVlookupMap && firstLayerGeo.length > 2 && !/^\d+$/.test(firstLayerGeo);

  // ── Loại B: Tính tổng tích lũy từ rawData để có thể xác nhận chéo ──
  // typeBCumulative[i] = tổng chiều dài tích lũy đến hết lớp i (theo rawData)
  const typeBCumulative: number[] = [];
  if (isTypeB) {
    let cum = 0;
    rawData.layers.forEach((layer: any) => {
      const len = layer.elevationFrom === 0
        ? Math.abs(layer.elevationTo)
        : Math.abs(layer.elevationTo - layer.elevationFrom);
      cum += (len || 0);
      typeBCumulative.push(parseFloat(cum.toFixed(3)));
    });
  }

  const processedLayers = fixDroppedHourDigit(rawData.layers).map((layer: any, idx: number) => {
    const geoCode = (layer.actualGeology || '').toString().trim();
    
    if (isTypeB) {
      // Loại B: actualGeology là mô tả chữ → layerDesign = actualGeology (không VLOOKUP)
      if (!layer.layerDesign || layer.layerDesign.trim().length < 3) {
        layer.layerDesign = geoCode;
      }
      // ⭐ Bỏ số thứ tự đầu mô tả (VD: "3.Sét lẫn..." → "Sét lẫn...")
      layer.layerDesign = stripLayerPrefix(layer.layerDesign);
      // ⭐ AUTO-ĐÁNH STT: designLayerCode = số thứ tự từ 1 trở đi (idx + 1), LUÔN ghi đè
      layer.designLayerCode = String(idx + 1);
      layer.layerNumber = idx + 1;
    } else {
      // Loại A: VLOOKUP từ designLayerMap
      if (geoCode && vlookupMap[geoCode]) {
        layer.layerDesign = vlookupMap[geoCode];
        layer.designLayerCode = geoCode;
      }
      // ⭐ Bỏ số thứ tự đầu mô tả cho Loại A (VD: "2.Sét pha..." → "Sét pha...")
      if (layer.layerDesign) {
        layer.layerDesign = stripLayerPrefix(layer.layerDesign);
      }
    }

    const startMinutes = parseTimeToMinutes(layer.timeFrom);
    const endMinutes = parseTimeToMinutes(layer.timeTo);
    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes < 0) durationMinutes += 24 * 60;
    if (durationMinutes <= 0) durationMinutes = 30; 
    const durationHours = durationMinutes / 60;

    let length: number;
    let finalElevationFrom = 0;
    let finalElevationTo = 0;

    if (isTypeB) {
      // Loại B: AI đọc thẳng elevationFrom = -(số trên), elevationTo = -(số dưới)
      // Chỉ tính length tạm, sẽ tính lại chính xác trong finalLayers
      const elevFrom = toNum(layer.elevationFrom, 0);
      const elevTo   = toNum(layer.elevationTo, 0);
      length = Math.abs(elevTo - elevFrom);
      if (length < 0.01) length = Math.abs(elevTo); // fallback
      finalElevationFrom = elevFrom;
      finalElevationTo   = elevTo;
    } else {
      // Loại A: chiều dài = khoảng cách tuyệt đối giữa 2 cao độ
      length = Math.abs(toNum(layer.elevationTo) - toNum(layer.elevationFrom));
      finalElevationFrom = toNum(layer.elevationFrom);
      finalElevationTo   = toNum(layer.elevationTo);
    }

    const speed = durationHours > 0 ? length / durationHours : 0;

    return sanitizeLayer({
      ...layer,
      actualGeology: geoCode,
      elevationFrom: finalElevationFrom,
      elevationTo: finalElevationTo,
      project: rawData.project,
      item: rawData.item,
      componentName: rawData.componentName,
      pileId: rawData.pileId,
      reportNumber: rawData.reportNumber,
      diameter: rawData.diameter,
      constructionStart: rawData.constructionStart,
      constructionEnd: rawData.constructionEnd,
      notes: layer.notes || '',
      durationHours: durationHours,
      lengthMeters: toNum(layer.lengthMeters, length),
      cumulativeDepth: toNum(layer.cumulativeDepth, 0),
      speedMph: speed
    });
  });

  // ── Kiểm tra và fallback casingElevation ──
  // casingElevation là CAO ĐỘ TUYỆT ĐỐI (m), đọc nguyên từ biên bản (có thể dương hoặc âm)
  // Công thức: elevationTo(lớp N) = casingElevation - cumulativeDepth(lớp N)
  const casingElevation = typeof rawData.casingElevation === 'number'
    ? rawData.casingElevation
    : null;

  let finalLayers = processedLayers;

  // ── Loại B: AI đọc trực tiếp elevationFrom/To từ biên bản (đã có dấu âm) ──
  // Chỉ cần tính lại lengthMeters = |elevationTo - elevationFrom|
  // Không tính toán gì thêm — tin tưởng giá trị AI đọc được
  if (isTypeB) {
    let prevElevTo = toNum(processedLayers[0]?.elevationFrom, 0);
    finalLayers = processedLayers.map((layer: any) => {
      const elevFrom = toNum(layer.elevationFrom, 0);
      const elevTo   = toNum(layer.elevationTo, 0);
      const newLength = Math.abs(elevTo - elevFrom);
      const newSpeed  = toNum(layer.durationHours) > 0 ? newLength / toNum(layer.durationHours) : toNum(layer.speedMph);
      return {
        ...layer,
        elevationFrom: elevFrom,
        elevationTo:   elevTo,
        lengthMeters:  newLength > 0 ? newLength : toNum(layer.lengthMeters),
        speedMph:      newSpeed,
      };
    });
  }

  return { 
    ...rawData, 
    constructionStart: normalizeDateTime(rawData.constructionStart), 
    constructionEnd: normalizeDateTime(rawData.constructionEnd), 
    reportType: isTypeB ? 'B' : 'A',
    layers: finalLayers,
    notes: rawData.notes || '',
    casingElevation: casingElevation,
  };
};

// --- Components ---

// --- Utilities ---
const expandYear = (val: string) => {
  if (!val) return val;
  let s = val.trim();
  
  // Extract all digits
  const digits = s.replace(/\D/g, '');
  
  // If we have 6 or 8 digits, treat as compact date
  if (digits.length === 6 || digits.length === 8) {
    let dStr = digits.slice(0, 2);
    let mStr = digits.slice(2, 4);
    let yStr = digits.slice(4);
    
    if (yStr.length === 2) yStr = '20' + yStr;
    
    let d = Math.min(Math.max(parseInt(dStr), 1), 31);
    let m = Math.min(Math.max(parseInt(mStr), 1), 12);
    
    return `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}/${yStr}`;
  }

  // If it has slashes or other separators, try to parse parts
  const parts = s.split(/[\/\-\.]/).filter(p => p.length > 0);
  if (parts.length >= 2) {
    let dStr = parts[0] || '';
    let mStr = parts[1] || '';
    let yStr = parts[2] || '';
    
    // Handle case where user typed DD/MMYYYY
    if (!yStr && mStr.length >= 4) {
      yStr = mStr.slice(2);
      mStr = mStr.slice(0, 2);
    }

    let d = Math.min(Math.max(parseInt(dStr) || 1, 1), 31);
    let m = Math.min(Math.max(parseInt(mStr) || 1, 1), 12);
    let y = yStr;

    if (y.length === 2) y = '20' + y;
    if (y.length === 0) y = new Date().getFullYear().toString();
    if (y.length > 4) y = y.slice(0, 4);
    if (y.length < 4 && y.length > 0) y = y.padStart(4, '0');
    if (y.length === 0) y = new Date().getFullYear().toString();

    return `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}/${y}`;
  }
  
  // If just digits but not 6 or 8, try to format anyway if it's long enough
  if (digits.length >= 4) {
     let dStr = digits.slice(0, 2);
     let mStr = digits.slice(2, 4);
     let yStr = digits.slice(4) || new Date().getFullYear().toString();
     
     if (yStr.length === 2) yStr = '20' + yStr;
     if (yStr.length > 4) yStr = yStr.slice(0, 4);
     
     let d = Math.min(Math.max(parseInt(dStr), 1), 31);
     let m = Math.min(Math.max(parseInt(mStr), 1), 12);
     
     return `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}/${yStr}`;
  }

  return s;
};

const expandDateTime = (val: string) => {
  if (!val) return val;
  let s = val.trim();

  // Tìm định dạng giờ: HH:mm hoặc HHhMM
  const timeMatch = s.match(/(\d{1,2})[:h](\d{1,2})/i);
  let timePart = "";
  let remaining = s;

  if (timeMatch) {
    timePart = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2].padStart(2, '0')}`;
    // Loại bỏ phần giờ để xử lý phần ngày riêng
    remaining = s.replace(timeMatch[0], '').trim();
  }

  // Nếu còn nội dung, thử mở rộng như một ngày
  if (remaining) {
    const expandedDate = expandYear(remaining);
    if (timePart) {
      return `${timePart} ${expandedDate}`;
    }
    return expandedDate;
  }

  return timePart || s;
};

// --- Components ---
const SmartDateInput = ({ 
  label, 
  value, 
  onChange 
}: { 
  label: string; 
  value: string; 
  onChange: (val: string) => void;
}) => {
  const [inputValue, setInputValue] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);

  // Sync internal input value with external value (YYYY-MM-DD -> DD/MM/YYYY)
  useEffect(() => {
    if (value && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, d] = value.split('-');
      setInputValue(`${d}/${m}/${y}`);
    } else if (!value) {
      setInputValue('');
    }
  }, [value]);

  const handleBlur = () => {
    const expanded = expandYear(inputValue);
    if (expanded !== inputValue) {
      setInputValue(expanded);
    }

    if (!expanded) {
      onChange('');
      return;
    }

    const parts = expanded.split(/[/.-]/);
    if (parts.length === 3) {
      let [d, m, y] = parts;
      if (y.length === 4 && d.length <= 2 && m.length <= 2) {
        const day = d.padStart(2, '0');
        const month = m.padStart(2, '0');
        const year = y;
        const isoDate = `${year}-${month}-${day}`;
        
        const date = new Date(isoDate);
        if (!isNaN(date.getTime())) {
          onChange(isoDate);
          setInputValue(`${day}/${month}/${year}`);
          return;
        }
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    
    // Only allow digits and separators
    val = val.replace(/[^\d\/\-\.]/g, '');
    if (val.length > 10) val = val.slice(0, 10);
    
    // Auto-format: add slashes if typing only digits
    const digits = val.replace(/\D/g, '');
    let displayValue = val;

    if (digits.length > 0 && !val.includes('/') && !val.includes('-') && !val.includes('.')) {
      displayValue = digits.slice(0, 2);
      if (digits.length > 2) {
        displayValue += '/' + digits.slice(2, 4);
        if (digits.length > 4) {
          displayValue += '/' + digits.slice(4, 8);
        }
      }
    }

    // Real-time "Smart" correction: 
    // If we have a "complete" looking string, try to expand it immediately
    if (digits.length === 6 || digits.length === 8 || displayValue.length === 10) {
      const expanded = expandYear(displayValue);
      if (expanded !== displayValue) {
        displayValue = expanded;
      }
    }

    setInputValue(displayValue);

    // Try to sync with parent state immediately if valid
    const parts = displayValue.split(/[\/\-\.]/);
    if (parts.length === 3) {
      let [d, m, y] = parts;
      if (y.length === 4 && d.length <= 2 && m.length <= 2) {
        const isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        const date = new Date(isoDate);
        if (!isNaN(date.getTime())) {
          onChange(isoDate);
        }
      }
    }
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // YYYY-MM-DD
    onChange(val);
  };

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">{label}</label>
      <div className="relative border border-slate-200 rounded-xl bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
        <button 
          type="button"
          onClick={() => {
            try {
              // @ts-ignore
              if (dateRef.current?.showPicker) {
                // @ts-ignore
                dateRef.current.showPicker();
              } else {
                dateRef.current?.focus();
              }
            } catch (e) {
              dateRef.current?.focus();
            }
          }}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition-colors"
        >
          <Calendar size={12} />
        </button>
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleBlur();
          }}
          placeholder="dd/mm/yyyy"
          className="w-full pl-9 pr-3.5 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium"
        />
        <input 
          type="date"
          ref={dateRef}
          value={value}
          onChange={handleNativeChange}
          className="absolute opacity-0 pointer-events-none w-0 h-0"
        />
      </div>
    </div>
  );
};

export default function App() {
  const [activeSheet, setActiveSheet] = useState<AppSheet>('upload');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<ExtractionResult | null>(null);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [pendingResults, setPendingResults] = useState<ExtractionResult[]>([]);
  const [conflictDialog, setConflictDialog] = useState<{
    result: ExtractionResult;
    conflicts: { geology: string; designs: string[] }[];
    onForce: () => void;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>('');
  // Multi API key: tối đa 5 key, tự động rotate khi hết quota
  const [geminiApiKeys, setGeminiApiKeys] = useState<string[]>(['', '', '', '', '']);
  const [activeKeyIndex, setActiveKeyIndex] = useState<number>(0);
  const [exhaustedKeys, setExhaustedKeys] = useState<Set<number>>(new Set());
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [isGithubConnected, setIsGithubConnected] = useState<boolean>(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState<boolean>(false);
  const [githubCreds, setGithubCreds] = useState<{token: string, username: string, repo: string} | null>(null);
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [githubUsernameInput, setGithubUsernameInput] = useState('');
  const [githubRepoInput, setGithubRepoInput] = useState('construction-reports');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingResult, setEditingResult] = useState<ExtractionResult | null>(null);
  const [downloadingExcelId, setDownloadingExcelId] = useState<string | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // ── Confirm Dialog (thay window.confirm) ──
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    detail?: string;
    type: 'save' | 'delete';
    onConfirm: () => void;
  } | null>(null);

  // ── Toast thông báo đồng bộ ──
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'loading' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'loading', duration = 3000) => {
    setToast({ message, type });
    if (type !== 'loading') setTimeout(() => setToast(null), duration);
  };

  // Bộ lọc Sheet 1
  const [filterProject, setFilterProject] = useState('');
  const [filterItem, setFilterItem] = useState('');
  const [filterStt, setFilterStt] = useState('');
  const [filterComponentName, setFilterComponentName] = useState('');
  const [filterPileId, setFilterPileId] = useState('');
  const [filterDiameter, setFilterDiameter] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const itemDropdownRef = useRef<HTMLDivElement>(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [showDiameterDropdown, setShowDiameterDropdown] = useState(false);
  const diameterDropdownRef = useRef<HTMLDivElement>(null);

  // Đóng dropdown khi click ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) setShowProjectDropdown(false);
      if (itemDropdownRef.current && !itemDropdownRef.current.contains(e.target as Node)) setShowItemDropdown(false);
      if (diameterDropdownRef.current && !diameterDropdownRef.current.contains(e.target as Node)) setShowDiameterDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load history, API key, and logo from localStorage and Supabase on mount
  useEffect(() => {
    const loadData = async () => {
      // Load localStorage CHỈ để hiển thị tạm trong khi chờ Supabase
      const savedApiKey = localStorage.getItem('gemini_api_key');
      if (savedApiKey) setUserApiKey(savedApiKey);
      const savedKeys = localStorage.getItem('gemini_api_keys');
      if (savedKeys) {
        try {
          const parsed = JSON.parse(savedKeys);
          if (Array.isArray(parsed)) setGeminiApiKeys(parsed);
        } catch {}
      }

      const savedLogo = localStorage.getItem('pile_drill_custom_logo');
      if (savedLogo) setCustomLogo(savedLogo);

      if (supabase) {
        try {
          // 1 & 2: Gọi song song để tiết kiệm thời gian và Egress
          const [historyRes, settingsRes] = await Promise.all([
            supabase
              .from('drill_extractions')
              // Lấy đầy đủ layers để tính chiều dài, thời gian, vận tốc chính xác
              .select('id, timestamp, project, item, componentName, pileId, reportNumber, diameter, constructionStart, constructionEnd, notes, fileName, fileUrl, excelUrl, stt, layers, casingElevation')
              .order('timestamp', { ascending: false }),
            supabase.from('app_settings').select('id, value'),
          ]);

          // Xử lý history
          if (!historyRes.error && historyRes.data) {
            // Merge với layers từ localStorage nếu có (để không mất data khi chưa load chi tiết)
            const savedHistory = localStorage.getItem('pile_drill_history');
            const localMap: Record<string, any> = {};
            if (savedHistory) {
              try {
                JSON.parse(savedHistory).forEach((r: any) => { localMap[r.id] = r; });
              } catch {}
            }
            const merged = historyRes.data.map((row: any) => {
              const local = localMap[row.id] || {};
              const rawLayers = (Array.isArray(row.layers) && row.layers.length > 0)
                ? row.layers
                : (Array.isArray(local.layers) && local.layers.length > 0)
                  ? local.layers
                  : [];
              // ⭐ Strip số thứ tự + ép kiểu số an toàn (tránh lỗi "toFixed is not a function")
              const cleanLayers = rawLayers.map((l: any) => sanitizeLayer({
                ...l,
                layerDesign: l.layerDesign ? stripLayerPrefix(l.layerDesign) : (l.layerDesign || ''),
              }));
              return {
                ...local,
                ...row,
                layers: cleanLayers,
              };
            });
            setHistory(merged);
            // Lưu lại localStorage với data mới nhất (chỉ fields đã fetch)
            localStorage.setItem('pile_drill_history', JSON.stringify(merged));
          } else {
            console.warn('[loadData] Supabase history error:', historyRes.error?.message);
            const savedHistory = localStorage.getItem('pile_drill_history');
            if (savedHistory) {
              try {
                const parsed = JSON.parse(savedHistory);
                setHistory(parsed.map((r: any) => ({ ...r, layers: (r.layers || []).map((l: any) => sanitizeLayer(l)) })));
              } catch {}
            }
          }

          // Xử lý settings + github creds trong 1 lần gọi duy nhất
          if (!settingsRes.error && settingsRes.data) {
            const sd = settingsRes.data;
            const apiKeySetting = sd.find((s: any) => s.id === 'gemini_api_key');
            const logoSetting = sd.find((s: any) => s.id === 'app_logo');
            const token = sd.find((s: any) => s.id === 'github_token')?.value || '';
            const username = sd.find((s: any) => s.id === 'github_username')?.value || '';
            const repo = sd.find((s: any) => s.id === 'github_repo')?.value || 'construction-reports';

            if (apiKeySetting?.value) {
              setUserApiKey(apiKeySetting.value);
              localStorage.setItem('gemini_api_key', apiKeySetting.value);
            }
            // Load danh sách 5 API key
            const allKeysSetting = sd.find((s: any) => s.id === 'gemini_api_keys');
            if (allKeysSetting?.value) {
              try {
                const parsed = JSON.parse(allKeysSetting.value);
                if (Array.isArray(parsed)) {
                  setGeminiApiKeys(parsed);
                  localStorage.setItem('gemini_api_keys', allKeysSetting.value);
                  // Sync userApiKey với key đầu tiên có giá trị
                  const first = parsed.find((k: string) => k.trim());
                  if (first) { setUserApiKey(first); localStorage.setItem('gemini_api_key', first); }
                }
              } catch {}
            } else if (apiKeySetting?.value) {
              // Backward compat: nếu chưa có gemini_api_keys thì set key[0] = key cũ
              setGeminiApiKeys(prev => [apiKeySetting.value, ...prev.slice(1)]);
            }
            if (logoSetting) {
              if (logoSetting.value) {
                setCustomLogo(logoSetting.value);
                localStorage.setItem('pile_drill_custom_logo', logoSetting.value);
              } else {
                setCustomLogo(null);
                localStorage.removeItem('pile_drill_custom_logo');
              }
            }
            if (token && username) {
              setGithubCreds({ token, username, repo });
              setGithubTokenInput(token);
              setGithubUsernameInput(username);
              setGithubRepoInput(repo);
              setIsGithubConnected(true);
            }
          }
        } catch (e) {
          console.error('[loadData] Supabase sync failed:', e);
          const savedHistory = localStorage.getItem('pile_drill_history');
          if (savedHistory) {
            try {
              const parsed = JSON.parse(savedHistory);
              setHistory(parsed.map((r: any) => ({ ...r, layers: (r.layers || []).map((l: any) => sanitizeLayer(l)) })));
            } catch {}
          }
        }
      } else {
        const savedHistory = localStorage.getItem('pile_drill_history');
        if (savedHistory) {
          try {
            const parsed = JSON.parse(savedHistory);
            setHistory(parsed.map((r: any) => ({ ...r, layers: (r.layers || []).map((l: any) => sanitizeLayer(l)) })));
          } catch {}
        }
      }
      setIsInitialLoading(false); // Tắt splash screen sau khi load xong
    };

    loadData();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        setIsGithubConnected(true);
        setIsConnectingGithub(false);
      }
    };
    window.addEventListener('message', handleMessage);

    // 3. Realtime Subscription for Settings
    let settingsSubscription: any = null;
    let extractionsSubscription: any = null;
    if (supabase) {
      settingsSubscription = supabase
        .channel('public:app_settings')
        .on('postgres_changes', { event: '*', table: 'app_settings', schema: 'public' }, (payload) => {
          const { id, value } = payload.new as any;
          if (id === 'gemini_api_key') {
            setUserApiKey(value);
            localStorage.setItem('gemini_api_key', value);
          } else if (id === 'gemini_api_keys') {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed)) {
                setGeminiApiKeys(parsed);
                localStorage.setItem('gemini_api_keys', value);
              }
            } catch {}
          } else if (id === 'app_logo') {
            if (value) {
              setCustomLogo(value);
              localStorage.setItem('pile_drill_custom_logo', value);
            } else {
              setCustomLogo(null);
              localStorage.removeItem('pile_drill_custom_logo');
            }
          }
        })
        .subscribe();

      // ── Realtime cho drill_extractions: đồng bộ ngay cho tất cả client ──
      extractionsSubscription = supabase
        .channel('public:drill_extractions')
        .on('postgres_changes', { event: 'INSERT', table: 'drill_extractions', schema: 'public' }, (payload) => {
          const rawRow = payload.new as ExtractionResult;
          const newRow = { ...rawRow, layers: (rawRow.layers || []).map((l: any) => sanitizeLayer(l)) };
          setHistory(prev => {
            // Tránh duplicate nếu chính client này vừa insert
            if (prev.some(r => r.id === newRow.id)) return prev;
            return [newRow, ...prev];
          });
          // Cập nhật localStorage
          try {
            const savedHistory = localStorage.getItem('pile_drill_history');
            const arr = savedHistory ? JSON.parse(savedHistory) : [];
            if (!arr.some((r: any) => r.id === newRow.id)) {
              localStorage.setItem('pile_drill_history', JSON.stringify([newRow, ...arr]));
            }
          } catch {}
        })
        .on('postgres_changes', { event: 'UPDATE', table: 'drill_extractions', schema: 'public' }, (payload) => {
          // payload.new chứa toàn bộ record — chỉ merge fields cần thiết để tránh overwrite layers từ local
          const rawUpdated = payload.new as ExtractionResult;
          const updated = { ...rawUpdated, layers: (rawUpdated.layers || []).map((l: any) => sanitizeLayer(l)) };
          setHistory(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
          // Cập nhật localStorage
          try {
            const savedHistory = localStorage.getItem('pile_drill_history');
            if (savedHistory) {
              const arr = JSON.parse(savedHistory);
              const newArr = arr.map((r: any) => r.id === updated.id ? { ...r, ...updated } : r);
              localStorage.setItem('pile_drill_history', JSON.stringify(newArr));
            }
          } catch {}
        })
        .on('postgres_changes', { event: 'DELETE', table: 'drill_extractions', schema: 'public' }, (payload) => {
          const deleted = payload.old as { id: string };
          setHistory(prev => prev.filter(r => r.id !== deleted.id));
          // Cập nhật localStorage
          try {
            const savedHistory = localStorage.getItem('pile_drill_history');
            if (savedHistory) {
              const arr = JSON.parse(savedHistory).filter((r: any) => r.id !== deleted.id);
              localStorage.setItem('pile_drill_history', JSON.stringify(arr));
            }
          } catch {}
        })
        .subscribe((status) => {
          console.log('[Realtime] drill_extractions subscription status:', status);
        });
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (settingsSubscription) supabase?.removeChannel(settingsSubscription);
      if (extractionsSubscription) supabase?.removeChannel(extractionsSubscription);
    };
  }, []);

  // Không tự động lưu history vào localStorage nữa
  // Supabase là source of truth, localStorage chỉ dùng fallback khi Supabase lỗi

  // Bấm Esc để đóng modal/overlay theo thứ tự ưu tiên
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Ưu tiên: EditModal > Settings > currentResult > Sidebar
      if (isEditModalOpen) {
        setIsEditModalOpen(false);
        setEditingResult(null);
      } else if (isSettingsOpen) {
        setIsSettingsOpen(false);
      } else if (currentResult) {
        setCurrentResult(null);
      } else if (isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditModalOpen, isSettingsOpen, currentResult, isSidebarOpen]);

  const saveApiKey = async (key: string) => {
    // key ở đây là keys[0] (key đầu tiên), nhưng ta lưu toàn bộ mảng
    const keysToSave = geminiApiKeys.map((k, i) => i === 0 ? key : k);
    setUserApiKey(key);
    setGeminiApiKeys(keysToSave);
    setActiveKeyIndex(0);
    setExhaustedKeys(new Set());
    localStorage.setItem('gemini_api_key', key);
    localStorage.setItem('gemini_api_keys', JSON.stringify(keysToSave));
    
    if (supabase) {
      try {
        await supabase.from('app_settings').upsert({ id: 'gemini_api_key', value: key, updated_at: new Date().toISOString() });
        await supabase.from('app_settings').upsert({ id: 'gemini_api_keys', value: JSON.stringify(keysToSave), updated_at: new Date().toISOString() });
        const logoValue = customLogo || '';
        await supabase.from('app_settings').upsert({ id: 'app_logo', value: logoValue, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to save settings to Supabase", e);
      }
    }
    
    setIsSettingsOpen(false);
  };

  // Lưu toàn bộ cấu hình 5 API key
  const saveAllApiKeys = async (keys: string[]) => {
    const validKeys = keys.map(k => k.trim());
    const firstKey = validKeys.find(k => k) || '';
    setGeminiApiKeys(validKeys);
    setUserApiKey(firstKey);
    setActiveKeyIndex(0);
    setExhaustedKeys(new Set());
    localStorage.setItem('gemini_api_key', firstKey);
    localStorage.setItem('gemini_api_keys', JSON.stringify(validKeys));

    if (supabase) {
      try {
        await supabase.from('app_settings').upsert({ id: 'gemini_api_key', value: firstKey, updated_at: new Date().toISOString() });
        await supabase.from('app_settings').upsert({ id: 'gemini_api_keys', value: JSON.stringify(validKeys), updated_at: new Date().toISOString() });
        const logoValue = customLogo || '';
        await supabase.from('app_settings').upsert({ id: 'app_logo', value: logoValue, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to save settings to Supabase", e);
      }
    }
    setIsSettingsOpen(false);
  };

  // ── Gọi AI với auto-rotate key khi hết quota ──
  const callExtractWithRotation = async (images: { base64: string; mimeType: string }[]): Promise<Omit<ExtractionResult, 'id' | 'timestamp'>> => {
    const validKeys = geminiApiKeys.filter(k => k.trim());
    if (validKeys.length === 0) {
      throw new Error("API Key không tồn tại. Vui lòng cấu hình trong phần Cài đặt.");
    }

    // Thử từng key trong vòng lặp
    let lastError: any = null;
    const tried = new Set<number>();

    // Bắt đầu từ activeKeyIndex
    let startIdx = activeKeyIndex;
    // Nếu key hiện tại đã bị đánh dấu exhausted thì tìm key tiếp theo
    while (exhaustedKeys.has(startIdx) && tried.size < validKeys.length) {
      tried.add(startIdx);
      startIdx = (startIdx + 1) % geminiApiKeys.length;
    }

    for (let attempt = 0; attempt < geminiApiKeys.length; attempt++) {
      const idx = (startIdx + attempt) % geminiApiKeys.length;
      const key = geminiApiKeys[idx]?.trim();
      if (!key || tried.has(idx)) continue;
      tried.add(idx);

      try {
        console.log(`[KeyRotation] Đang dùng API Key #\${idx + 1}`);
        const result = await extractDataFromFile(images, key);
        // Thành công — cập nhật activeKeyIndex
        if (idx !== activeKeyIndex) {
          setActiveKeyIndex(idx);
          setUserApiKey(key);
          console.log(`[KeyRotation] Đã chuyển sang Key #\${idx + 1} thành công`);
        }
        return result;
      } catch (err: any) {
        if (isQuotaError(err)) {
          console.warn(`[KeyRotation] Key #\${idx + 1} hết quota, thử key tiếp theo...`);
          setExhaustedKeys(prev => new Set(prev).add(idx));
          lastError = err;
          continue;
        }
        // Lỗi khác (không phải quota) → ném ra ngay
        throw err;
      }
    }

    // Hết tất cả key
    const totalValid = geminiApiKeys.filter(k => k.trim()).length;
    throw new Error(`⛔ Tất cả \${totalValid} API Key Gemini đã hết quota! Vui lòng vào Cài đặt để thêm key mới hoặc chờ quota được reset.`);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const originalBase64 = event.target?.result as string;

      // Nén ảnh logo xuống tối đa 300x300px để tránh vượt giới hạn lưu trữ
      const compressLogo = (src: string): Promise<string> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const MAX = 300;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png', 0.9));
          };
          img.onerror = () => resolve(src);
          img.src = src;
        });
      };

      const base64 = await compressLogo(originalBase64);

      // Cập nhật UI + localStorage ngay lập tức
      setCustomLogo(base64);
      localStorage.setItem('pile_drill_custom_logo', base64);

      // Lưu vào Supabase
      if (supabase) {
        try {
          const { error } = await supabase
            .from('app_settings')
            .upsert({ id: 'app_logo', value: base64, updated_at: new Date().toISOString() });
          if (error) {
            console.error("Failed to save logo to Supabase:", error.message);
            // Logo vẫn được lưu ở localStorage, chỉ cảnh báo nếu Supabase lỗi
            alert("⚠️ Logo đã lưu cục bộ nhưng không đồng bộ được lên server: " + error.message);
          }
        } catch (e: any) {
          console.error("Failed to save logo to Supabase", e);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const resetLogo = async () => {
    setCustomLogo(null);
    localStorage.removeItem('pile_drill_custom_logo');
    
    // Clear in Supabase
    if (supabase) {
      try {
        await supabase
          .from('app_settings')
          .upsert({ id: 'app_logo', value: '', updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to reset logo in Supabase", e);
      }
    }
  };

  const connectGithub = async () => {
    const token = githubTokenInput.trim();
    const username = githubUsernameInput.trim();
    const repo = githubRepoInput.trim() || 'construction-reports';

    if (!token || !username) {
      alert("Vui lòng nhập đầy đủ GitHub Token và Username.");
      return;
    }

    if (supabase) {
      try {
        await supabase.from('app_settings').upsert([
          { id: 'github_token', value: token, updated_at: new Date().toISOString() },
          { id: 'github_username', value: username, updated_at: new Date().toISOString() },
          { id: 'github_repo', value: repo, updated_at: new Date().toISOString() },
        ]);
        setGithubCreds({ token, username, repo });
        setIsGithubConnected(true);
        alert("✅ Đã kết nối GitHub thành công!");
      } catch (e: any) {
        alert("❌ Lỗi lưu thông tin GitHub: " + (e?.message || e));
      }
    } else {
      alert("❌ Cần kết nối Supabase trước để lưu thông tin GitHub.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: ProcessingFile[] = Array.from(files).map(file => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      status: 'pending',
      progress: 0
    }));

    setProcessingFiles(prev => [...newFiles, ...prev]);
    setIsProcessing(true);
    setError(null);

    const collectedResults: ExtractionResult[] = [];

        // ── Chuẩn bị file: đọc + nén/convert (CPU-bound, chạy song song 100%) ──

        const processFile = async (pFile: ProcessingFile, file: File) => {
          setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'processing', progress: 10 } : f));
          try {
            // Bước 1: chuẩn bị (nén/convert) — 10→40%
            const { images, fileName } = await prepareFile(file);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 40 } : f));

            // Bước 2: gọi AI — 40→90%
            const rawResult = await callExtractWithRotation(images);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 90 } : f));

            // Tự động tra cứu (VLOOKUP) mô tả địa chất dựa trên mã địa chất thực tế
            // Chỉ áp dụng VLOOKUP cho Loại A (có designLayerMap), không áp dụng cho Loại B
            const map = rawResult.designLayerMap || {};
            const hasMap = Object.keys(map).length > 0;
            const normalizedLayers = (rawResult.layers || []).map(layer => {
              const geoCode = (layer.actualGeology || '').trim();
              const currentDesign = (layer.layerDesign || '').trim();
              
              // Chỉ VLOOKUP nếu có map VÀ geoCode là số (Loại A)
              if (hasMap && geoCode && /^\d+$/.test(geoCode) && map[geoCode]) {
                if (!currentDesign || currentDesign.length < 5 || currentDesign !== map[geoCode]) {
                  return sanitizeLayer({ ...layer, layerDesign: stripLayerPrefix(map[geoCode]) });
                }
              }
              // Loại B: giữ nguyên nhưng strip số thứ tự đầu mô tả
              return sanitizeLayer({ ...layer, layerDesign: stripLayerPrefix(layer.layerDesign || '') });
            });

            const result: ExtractionResult = {
              ...rawResult,
              layers: normalizedLayers,
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              fileName,
              _base64: images[0]?.base64,
              _mimeType: images[0]?.mimeType,
            };

            collectedResults.push(result);
            setPendingResults(prev => [result, ...prev]);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'completed', progress: 100, result } : f));
          } catch (err: any) {
            console.error(err);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'error', error: err.message || 'Lỗi không xác định' } : f));
          }
        };

        // ── Xử lý song song: tất cả file chạy đồng thời (không chờ tuần tự) ──
        // Giới hạn CONCURRENCY = 3 để tránh spam API / quá tải trình duyệt
        const CONCURRENCY = 3;
        const fileList = Array.from(files);
        for (let i = 0; i < fileList.length; i += CONCURRENCY) {
          const batch = fileList.slice(i, i + CONCURRENCY);
          const batchFiles = newFiles.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map((file, j) => processFile(batchFiles[j], file)));
        }

    // KHÔNG tự động lưu nữa, để người dùng kiểm tra và bấm "Lưu tất cả"
    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    // Tự động chọn file đầu tiên để hiển thị nếu chưa chọn file nào
    if (collectedResults.length > 0 && !currentResult) {
      setCurrentResult(collectedResults[0]);
    }
  };

  const removeProcessingFile = (id: string) => {
    setProcessingFiles(prev => prev.filter(f => f.id !== id));
  };

  // Helper dùng chung: Xóa 1 file trên GitHub theo raw URL
  const deleteGithubFile = async (
    rawUrl: string,
    creds: { token: string; username: string; repo: string }
  ): Promise<void> => {
    const { token, username, repo } = creds;
    const cleanUrl = decodeURIComponent(rawUrl.split('?')[0]);

    let path = '';
    const rawMatch = cleanUrl.match(/raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/[^\/]+\/(.+)/);
    const blobMatch = cleanUrl.match(/github\.com\/[^\/]+\/[^\/]+\/blob\/[^\/]+\/(.+)/);
    if (rawMatch) path = rawMatch[1];
    else if (blobMatch) path = blobMatch[1];
    if (!path) return;

    const headers = {
      'Authorization': `token ${token.trim()}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };

    // Thử qua backend trước
    try {
      const delRes = await fetch('/api/github/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: rawUrl })
      });
      if (delRes.ok) return;
    } catch (_) {}

    // Fallback: client-side delete
    const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${path}`;
    const getRes = await fetch(apiUrl, { headers });
    if (!getRes.ok) return; // file không tồn tại — ok
    const fileData = await getRes.json();
    await fetch(apiUrl, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ message: `Delete: ${path}`, sha: fileData.sha })
    });
  };

  // Helper: Upsert Excel lên GitHub — ghi đè file cũ nếu đã tồn tại (dùng SHA), tạo mới nếu chưa có
  // Path cố định: SGC-CKN/Excel/{id}.xlsx → mỗi biên bản CHỈ có đúng 1 file Excel duy nhất
  // Tạo tên file Excel chuẩn: TênBộPhận_SốHiệuCọc_ĐườngKính_NgàyKếtThúc
  const upsertExcelToGitHub = async (
    id: string,
    excelBase64: string,
    creds: { token: string; username: string; repo: string },
    existingExcelUrl?: string,
    result?: ExtractionResult
  ): Promise<string | null> => {
    const { token, username, repo } = creds;

    // Tên file đẹp theo format chuẩn, id ở đầu đảm bảo unique khi ghi đè
    const friendlyName = result ? buildExcelFileName(result) : id;
    const fileName = `${id}_${friendlyName}.xlsx`;

    // Nếu đã có URL cũ trên GitHub → lấy path từ URL cũ để ghi đè đúng file
    let excelPath = `SGC-CKN/Excel/${fileName}`;
    if (existingExcelUrl) {
      const match = decodeURIComponent(existingExcelUrl).match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)/);
      if (match) excelPath = match[1]; // giữ nguyên path cũ để ghi đè
    }

    const rawUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/${excelPath}`;
    const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${excelPath}`;
    const headers = {
      'Authorization': `Bearer ${token.trim()}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };

    // Lấy SHA của file hiện tại (nếu có) để ghi đè
    let sha: string | undefined;
    try {
      // Thêm cache-busting query param để đảm bảo lấy SHA mới nhất
      const getRes = await fetch(`${apiUrl}?t=${new Date().getTime()}`, { 
        headers: { 'Authorization': headers['Authorization'], 'Accept': headers['Accept'] } 
      });
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
      }
    } catch (_) {}

    const body: any = {
      message: sha ? `Update Excel: ${friendlyName}` : `Create Excel: ${friendlyName}`,
      content: excelBase64,
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (putRes.ok) return rawUrl;
    const err = await putRes.json().catch(() => ({}));
    console.error('upsertExcelToGitHub failed:', err);
    return null;
  };

  // Hàm tạo Excel buffer (không download, chỉ trả về base64) để upload GitHub
  const generateExcelBase64 = async (result: ExtractionResult, imageData?: { base64: string; ext: string } | null): Promise<string | null> => {
    try {
      const ExcelJS = await loadExcelJS();
      const argb = (hex: string) => 'FF' + hex.toUpperCase();
      const thinBorder = (color = 'CCCCCC') => ({
        top: { style: 'thin' as const, color: { argb: argb(color) } },
        bottom: { style: 'thin' as const, color: { argb: argb(color) } },
        left: { style: 'thin' as const, color: { argb: argb(color) } },
        right: { style: 'thin' as const, color: { argb: argb(color) } },
      });
      const applyCell = (cell: any, value: any, opts: { bg?: string; fontColor?: string; bold?: boolean; sz?: number; align?: string; wrap?: boolean; border?: any }) => {
        cell.value = value;
        cell.font = { name: 'Arial', size: opts.sz ?? 10, bold: opts.bold ?? false, color: { argb: argb(opts.fontColor ?? '000000') } };
        if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(opts.bg) } };
        cell.alignment = { horizontal: (opts.align ?? 'center') as any, vertical: 'middle', wrapText: opts.wrap ?? false };
        cell.border = opts.border ?? thinBorder();
      };

      const wb = new ExcelJS.Workbook();
      wb.creator = 'SGC-CKN'; wb.created = new Date();

      let gc = 0; let pk = '';
      const rowColorIdx = result.layers.map((layer) => {
        const key = layer.layerDesign?.trim() || '__';
        if (key !== pk) { gc++; pk = key; }
        return Math.max(0, gc - 1) % GROUP_COLORS.length;
      });

      const ws1 = wb.addWorksheet('Chi tiết địa chất');
      ws1.columns = [
        { width: 14 },{ width: 11 },{ width: 46 },{ width: 13 },{ width: 13 },
        { width: 11 },{ width: 11 },{ width: 11 },{ width: 9 },{ width: 9 },{ width: 28 },
      ];

      const infoItems = [
        ['Dự án', result.project],['Hạng mục', result.item],
        ['Tên bộ phận', result.componentName],['Số hiệu cọc', result.pileId],
        ['Tên Máy khoan', result.reportNumber],['Đường kính', result.diameter],
        ['Bắt đầu thi công', result.constructionStart],['Kết thúc thi công', result.constructionEnd],
      ];
      infoItems.forEach(([k, v]) => {
        const row = ws1.addRow([k, v]);
        row.height = 18;
        applyCell(row.getCell(1), k, { bg: 'EFF6FF', fontColor: '1E3A6E', bold: true, align: 'left', border: thinBorder('DBEAFE') });
        applyCell(row.getCell(2), v, { bg: 'FFFFFF', fontColor: '374151', align: 'left', border: thinBorder('DBEAFE') });
        ws1.mergeCells(row.number, 2, row.number, 11);
      });
      const blankRow = ws1.addRow([]); blankRow.height = 6;

      const hdrCols = ['Địa chất TT','Đường kính','Mô tả lớp thiết kế','Từ (h)','Đến (h)','Cao độ từ','Cao độ đến','T.Gian (h)','Dài (m)','V (m/h)','Ghi chú'];
      const hdrRow = ws1.addRow(hdrCols);
      hdrRow.height = 36;
      hdrCols.forEach((h, ci) => {
        applyCell(hdrRow.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 || ci === 10 ? 'left' : 'center', wrap: true, border: thinBorder('FFFFFF') });
      });

      result.layers.forEach((layer, ri) => {
        const { bg, font: fontColor } = GROUP_COLORS[rowColorIdx[ri]];
        const spd = layer.speedMph;
        const isSlowSpd = spd > 0 && spd <= 1;
        const spdBg = isSlowSpd ? 'DC2626' : spd > 5 ? 'D1FAE5' : 'FFF7ED';
        const spdFontColor = isSlowSpd ? 'FFFFFF' : 'C2410C';
        const vals = [
          getGeoDisplay(layer), result.diameter, layer.layerDesign,
          layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
          layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
          layer.elevationFrom, layer.elevationTo,
          parseFloat(toNum(layer.durationHours).toFixed(2)),
          parseFloat(toNum(layer.lengthMeters).toFixed(2)),
          parseFloat(spd.toFixed(2)),
          layer.notes || '',
        ];
        const dataRow = ws1.addRow(vals);
        dataRow.height = 36;
        vals.forEach((v, ci) => {
          const isSpd = ci === 9;
          applyCell(dataRow.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? spdFontColor : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 || ci === 10 ? 'left' : 'center', wrap: ci === 2 || ci === 3 || ci === 4 || ci === 10, border: thinBorder() });
        });
      });

      if (imageData) {
        const imgId = wb.addImage({ base64: imageData.base64, extension: imageData.ext as any });
        const startRow = 11 + result.layers.length + 2;
        const titleRow = ws1.getRow(startRow);
        titleRow.height = 25;
        applyCell(titleRow.getCell(1), 'ẢNH BIÊN BẢN GỐC', { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 12, align: 'center', border: thinBorder('1A3A6B') });
        ws1.mergeCells(startRow, 1, startRow, 11);
        
        // tl.row là 0-indexed: startRow (1-indexed) → startRow-1 là dòng tiêu đề (0-indexed)
        // Ảnh đặt bắt đầu từ dòng NGAY SAU tiêu đề → tl.row = startRow (0-indexed)
        ws1.addImage(imgId, {
          tl: { col: 0, row: startRow }, // startRow (0-indexed) = dòng ngay sau tiêu đề (startRow là 1-indexed row)
          ext: { width: 850, height: 1100 },
        });
        
        // Đảm bảo các dòng có chiều cao đủ để hiển thị ảnh
        for (let i = startRow + 1; i <= startRow + 60; i++) {
          ws1.getRow(i).height = 20;
        }
      } else {
        // Nếu thiếu ảnh, thêm dòng cảnh báo vào Excel
        const startRow = 11 + result.layers.length + 2;
        const titleRow = ws1.getRow(startRow);
        titleRow.height = 25;
        applyCell(titleRow.getCell(1), '⚠️ CẢNH BÁO: THIẾU HÌNH ẢNH BIÊN BẢN GỐC TRONG DỮ LIỆU', { bg: 'FEE2E2', fontColor: '991B1B', bold: true, sz: 12, align: 'center', border: thinBorder('991B1B') });
        ws1.mergeCells(startRow, 1, startRow, 11);
      }

      const ws2 = wb.addWorksheet('Tổng hợp lớp thiết kế');
      ws2.columns = [{ width: 6 },{ width: 11 },{ width: 46 },{ width: 10 },{ width: 14 },{ width: 14 },{ width: 14 },{ width: 12 },{ width: 12 }];
      const hdr2 = ['STT','Đường kính','Lớp Thiết Kế','Số đoạn','Cao độ từ (m)','Cao độ đến (m)','Tổng T.Gian (h)','Tổng Dài (m)','V TB (m/h)'];
      const hdrRow2 = ws2.addRow(hdr2);
      hdrRow2.height = 36;
      hdr2.forEach((h, ci) => {
        applyCell(hdrRow2.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 ? 'left' : 'center', wrap: true, border: thinBorder('FFFFFF') });
      });

      const groups: any[] = [];
      let gc2 = 0; let pk2 = '';
      result.layers.forEach((layer) => {
        const key = layer.layerDesign?.trim() || '(Chưa có)';
        if (key !== pk2) { gc2++; pk2 = key; }
        const ci2 = Math.max(0, gc2 - 1) % GROUP_COLORS.length;
        const last = groups[groups.length - 1];
        if (last && last.layerDesign === key) {
          last.segments++; last.elevationTo = layer.elevationTo;
          last.totalDuration += layer.durationHours; last.totalLength += layer.lengthMeters;
        } else {
          groups.push({ layerDesign: key, segments: 1, elevationFrom: layer.elevationFrom, elevationTo: layer.elevationTo, totalDuration: layer.durationHours, totalLength: layer.lengthMeters, colorIdx: ci2 });
        }
      });
      groups.forEach(g => { g.avgSpeed = g.totalDuration > 0 ? g.totalLength / g.totalDuration : 0; });
      const totalDur = groups.reduce((s, g) => s + g.totalDuration, 0);
      const totalLen2 = groups.reduce((s, g) => s + g.totalLength, 0);
      const totalAvgSpd = totalDur > 0 ? totalLen2 / totalDur : 0;

      groups.forEach((g, i) => {
        const { bg, font: fontColor } = GROUP_COLORS[g.colorIdx];
        const isSlowSpd = g.avgSpeed > 0 && g.avgSpeed <= 1;
        const spdBg = isSlowSpd ? 'DC2626' : g.avgSpeed > 5 ? 'D1FAE5' : 'FFF7ED';
        const vals2 = [i + 1, result.diameter, g.layerDesign, g.segments, parseFloat(toNum(g.elevationFrom).toFixed(2)), parseFloat(toNum(g.elevationTo).toFixed(2)), parseFloat(g.totalDuration.toFixed(2)), parseFloat(g.totalLength.toFixed(2)), parseFloat(g.avgSpeed.toFixed(2))];
        const r2 = ws2.addRow(vals2);
        r2.height = 32;
        vals2.forEach((v, ci) => {
          const isSpd = ci === 8;
          applyCell(r2.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? (isSlowSpd ? 'FFFFFF' : 'C2410C') : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 ? 'left' : 'center', wrap: ci === 2, border: thinBorder() });
        });
      });

      const totVals = ['TỔNG CỘNG','','',result.layers.length,
        result.layers.length > 0 ? parseFloat(toNum(result.layers[0].elevationFrom).toFixed(2)) : '',
        result.layers.length > 0 ? parseFloat(toNum(result.layers[result.layers.length - 1].elevationTo).toFixed(2)) : '',
        parseFloat(totalDur.toFixed(2)),parseFloat(totalLen2.toFixed(2)),parseFloat(totalAvgSpd.toFixed(2))];
      const totRow = ws2.addRow(totVals);
      totRow.height = 28;
      totVals.forEach((v, ci) => {
        applyCell(totRow.getCell(ci + 1), v, { bg: 'E2E8F0', fontColor: '1E3A6E', bold: true, sz: 11, align: ci === 0 ? 'left' : 'center', border: { ...thinBorder(), top: { style: 'medium' as const, color: { argb: argb('1E3A6E') } } } });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result as string;
          resolve(res.split(',')[1]);
        };
        reader.readAsDataURL(blob);
      });
      return base64;
    } catch (e) {
      console.error('generateExcelBase64 error:', e);
      return null;
    }
  };

  // ── Kiểm tra tính nhất quán: cùng số TT địa chất → mô tả lớp thiết kế phải giống nhau ──
  const validateLayerConsistency = (result: ExtractionResult): { valid: boolean; conflicts: { geology: string; designs: string[] }[] } => {
    const map: Record<string, Set<string>> = {};
    (result.layers || []).forEach(layer => {
      const geo = (layer.actualGeology || '').trim();
      const design = (layer.layerDesign || '').trim();
      if (!geo || !design) return;
      if (!map[geo]) map[geo] = new Set();
      map[geo].add(design);
    });
    const conflicts = Object.entries(map)
      .filter(([, designs]) => designs.size > 1)
      .map(([geology, designs]) => ({ geology, designs: Array.from(designs) }));
    return { valid: conflicts.length === 0, conflicts };
  };

  const ensureImageData = async (result: ExtractionResult, creds?: { token: string } | null): Promise<{ base64: string; ext: string } | null> => {
    try {
      console.log(`[ensureImageData] Bắt đầu xử lý cho ID: ${result.id}, fileName: ${result.fileName}`);
      
      // 1. Ưu tiên dùng _base64 nếu có (đối với file mới upload chưa lưu hoặc còn cache)
      if (result._base64) {
        console.log(`[ensureImageData] Sử dụng _base64 từ bộ nhớ tạm`);
        const parts = result._base64.split(',');
        if (parts.length > 1) {
          const mime = result._mimeType || '';
          // Nếu là PDF thì convert sang ảnh
          if (mime.includes('pdf') || result.fileName?.toLowerCase().endsWith('.pdf')) {
            try {
              console.log(`[ensureImageData] Đang chuyển đổi PDF sang ảnh...`);
              const imgDataUrl = await convertPdfToImage(result._base64);
              const imgParts = imgDataUrl.split(',');
              if (imgParts.length > 1) {
                return { base64: imgParts[1], ext: 'jpeg' };
              }
            } catch (e) {
              console.error('[ensureImageData] convertPdfToImage failed from _base64:', e);
            }
          } else {
            const ext = mime.includes('png') ? 'png' : 'jpeg';
            return { base64: parts[1], ext };
          }
        }
      }
      
      // 2. Nếu không có _base64, thử lấy từ fileUrl (GitHub)
      let url = result.fileUrl;
      if (url) {
        console.log(`[ensureImageData] Đang tải ảnh từ URL: ${url}`);
        // Chuẩn hoá URL về dạng raw.githubusercontent.com nếu cần
        if (url.includes('github.com') && url.includes('/blob/')) {
          url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        }

        // Chiến lược 1: Dùng proxy server-side (tránh CORS, hỗ trợ token từ env)
        try {
          const proxyResp = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
          if (proxyResp.ok) {
            const buf = await proxyResp.arrayBuffer();
            if (buf.byteLength > 100) {
              console.log(`[ensureImageData] Proxy thành công, size=${buf.byteLength}`);
              return await processBlob(new Blob([buf]), url);
            }
          }
          console.warn(`[ensureImageData] Proxy trả về không hợp lệ, thử phương án khác...`);
        } catch (proxyErr) {
          console.warn('[ensureImageData] Proxy thất bại:', proxyErr);
        }

        // Chiến lược 2: Fetch trực tiếp với token
        try {
          const headers: HeadersInit = {};
          if (creds?.token) {
            headers['Authorization'] = `token ${creds.token}`;
          }
          const res = await fetch(url, { headers, cache: 'no-store' });
          if (res.ok) {
            const buf = await res.arrayBuffer();
            if (buf.byteLength > 100) {
              console.log(`[ensureImageData] Fetch trực tiếp thành công, size=${buf.byteLength}`);
              return await processBlob(new Blob([buf]), url);
            }
          }
          console.warn(`[ensureImageData] Fetch trực tiếp thất bại: ${res.status}`);
        } catch (directErr) {
          console.warn('[ensureImageData] Fetch trực tiếp lỗi:', directErr);
        }

        // Chiến lược 3: GitHub Contents API với Accept: raw
        try {
          const m = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
          if (m) {
            const [, owner, repo, branch, filePath] = m;
            const apiHeaders: HeadersInit = { 'Accept': 'application/vnd.github.v3.raw' };
            if (creds?.token) apiHeaders['Authorization'] = `token ${creds.token}`;
            const apiResp = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
              { headers: apiHeaders }
            );
            if (apiResp.ok) {
              const buf = await apiResp.arrayBuffer();
              if (buf.byteLength > 100) {
                console.log(`[ensureImageData] GitHub API thành công, size=${buf.byteLength}`);
                return await processBlob(new Blob([buf]), url);
              }
            }
          }
        } catch (apiErr) {
          console.warn('[ensureImageData] GitHub API thất bại:', apiErr);
        }

        console.error(`[ensureImageData] Tất cả chiến lược thất bại cho URL: ${url}`);
      }
    } catch (e) {
      console.error('[ensureImageData] failed:', e);
    }
    return null;
  };

  const processBlob = async (blob: Blob, url: string): Promise<{ base64: string; ext: string } | null> => {
    const base64Full = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    
    const isPdf = url.toLowerCase().split('?')[0].endsWith('.pdf') || blob.type.includes('pdf');
    if (isPdf) {
      try {
        const imgDataUrl = await convertPdfToImage(base64Full);
        const imgParts = imgDataUrl.split(',');
        if (imgParts.length > 1) {
          return { base64: imgParts[1], ext: 'jpeg' };
        }
      } catch (e) {
        console.error('[ensureImageData] convertPdfToImage from blob failed:', e);
      }
    } else {
      const parts = base64Full.split(',');
      if (parts.length > 1) {
        const ext = blob.type.includes('png') ? 'png' : 'jpeg';
        return { base64: parts[1], ext };
      }
    }
    return null;
  };

  const saveResult = async (result: ExtractionResult, skipValidation = false) => {
    // ── Validate trước khi lưu: cùng số TT địa chất → lớp thiết kế phải nhất quán ──
    if (!skipValidation) {
      const { valid, conflicts } = validateLayerConsistency(result);
      if (!valid) {
        // Hiện dialog cảnh báo, không lưu ngay
        setConflictDialog({
          result,
          conflicts,
          onForce: () => {
            setConflictDialog(null);
            saveResult(result, true); // force save sau khi người dùng xác nhận
          },
        });
        return;
      }
    }

    let finalResult = { ...result };

    // 1. Upload file lên GitHub (nếu chưa có fileUrl và có dữ liệu file)
    if (isGithubConnected && !finalResult.fileUrl && finalResult._base64) {
      try {
        const base64 = finalResult._base64;
        let uploadData: any = null;

        // Try backend first
        try {
          const uploadRes = await fetch('/api/github/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: finalResult.fileName, base64Data: base64 })
          });
          if (uploadRes.ok) uploadData = await uploadRes.json();
        } catch (_) {}

          // Client-side fallback
          if (!uploadData && githubCreds) {
            const { token, username, repo } = githubCreds;
            const timestamp = new Date().getTime();
            const safeFileName = (finalResult.fileName || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
            const path = `SGC-CKN/${timestamp}_${safeFileName}`;
            const content = base64.split(',')[1];
            const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${path}`;

            // Check for SHA just in case, with cache-busting
            let sha: string | undefined;
            try {
              const getRes = await fetch(`${apiUrl}?t=${timestamp}`, {
                headers: {
                  'Authorization': `Bearer ${token.trim()}`,
                  'Accept': 'application/vnd.github.v3+json'
                }
              });
              if (getRes.ok) {
                const getData = await getRes.json();
                sha = getData.sha;
              }
            } catch (_) {}

            const ghRes = await fetch(apiUrl, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token.trim()}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ 
                message: `Upload ${finalResult.fileName} via SGC-CKN Web`, 
                content,
                sha: sha
              })
            });

            if (ghRes.ok) {
              const rawUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/${path}`;
              uploadData = { fileUrl: rawUrl };
            } else {
              const err = await ghRes.json();
              alert(`⚠️ Lỗi upload GitHub: ${err.message || 'Không thể upload file'}. Dữ liệu vẫn sẽ được lưu vào Supabase.`);
            }
          }

        if (uploadData?.fileUrl) {
          finalResult.fileUrl = uploadData.fileUrl;
        }
      } catch (e) {
        console.error("GitHub upload failed", e);
      }
    }

    // 1b. Tự động tạo Excel và upload lên GitHub (path cố định theo id, luôn ghi đè file cũ)
    if (isGithubConnected && githubCreds) {
      try {
        const autoImg = await ensureImageData(finalResult, githubCreds);
        
        // Kiểm soát nghiêm ngặt: Nếu có file gốc mà không lấy được ảnh để nhúng vào Excel thì cảnh báo
        if ((finalResult._base64 || finalResult.fileUrl) && !autoImg) {
          const confirmMsg = `⚠️ Hệ thống không thể trích xuất hình ảnh từ biên bản "${finalResult.fileName || 'này'}". \n\nFile Excel xuất ra sẽ KHÔNG có hình ảnh đính kèm. Bạn có chắc chắn muốn tiếp tục lưu không?`;
          if (!window.confirm(confirmMsg)) {
            setIsProcessing(false);
            return;
          }
        }

        const excelBase64 = await generateExcelBase64(finalResult, autoImg);
        if (excelBase64) {
          const newUrl = await upsertExcelToGitHub(finalResult.id, excelBase64, githubCreds, finalResult.excelUrl, finalResult);
          if (newUrl) finalResult.excelUrl = newUrl;
        }
      } catch (e) {
        console.error('Auto Excel upload error:', e);
      }
    }


    // 2. Lưu vào Supabase — nếu lỗi thì dọn dẹp file Excel trên GitHub để tránh mất đồng bộ
    if (supabase) {
      try {
        // QUAN TRỌNG: phải giữ `id` để sau này update().eq('id', ...) tìm được record
        const { _base64, _mimeType, designLayerMap, ...dataToSave } = finalResult as any;
        const { error: supabaseError } = await supabase.from('drill_extractions').insert([dataToSave]);
        if (supabaseError) {
          // Rollback: xóa Excel vừa upload trên GitHub nếu Supabase thất bại
          if (finalResult.excelUrl && githubCreds) {
            await deleteGithubFile(finalResult.excelUrl, githubCreds).catch(() => {});
          }
          alert("❌ Lỗi khi lưu vào Supabase: " + supabaseError.message);
          return;
        }
      } catch (e: any) {
        if (finalResult.excelUrl && githubCreds) {
          await deleteGithubFile(finalResult.excelUrl, githubCreds).catch(() => {});
        }
        alert("❌ Lỗi kết nối Supabase: " + e.message);
        return;
      }
    } else {
      alert("❌ Không thể kết nối Supabase.");
      return;
    }

    // 3. Cập nhật UI
    const { _base64: _b, _mimeType: _m, ...cleanResult } = finalResult;
    setHistory(prev => [cleanResult, ...prev]);
    setPendingResults(prev => prev.filter(r => r.id !== result.id));
    setCurrentResult(null);
    // Cập nhật processing files nếu có
    setProcessingFiles(prev => prev.map(f => 
      f.result?.id === result.id ? { ...f, result: cleanResult } : f
    ));
  };

  const handleSaveAll = async () => {
    if (pendingResults.length === 0) return;

    // ── QUAN TRỌNG: Merge currentResult (data đang chỉnh sửa) vào pendingResults ──
    // Đảm bảo lấy data MỚI NHẤT dù user chưa bấm "Lưu thay đổi" trong EditSplitView
    let latestPending = pendingResults;
    if (currentResult) {
      latestPending = pendingResults.map(r =>
        r.id === currentResult.id ? { ...currentResult } : r
      );
      // Cập nhật state luôn để nhất quán
      setPendingResults(latestPending);
    }

    // Kiểm tra tính nhất quán cho TẤT CẢ biên bản trước khi lưu
    for (const r of latestPending) {
      const { valid, conflicts } = validateLayerConsistency(r);
      if (!valid) {
        // Dừng lại, hiện dialog cho biên bản bị lỗi
        setConflictDialog({
          result: r,
          conflicts,
          onForce: async () => {
            setConflictDialog(null);
            // Lưu biên bản này (bỏ qua validate) rồi tiếp tục
            await saveResult(r, true);
            // Tiếp tục lưu các biên bản còn lại
            const remaining = latestPending.filter(x => x.id !== r.id);
            for (const rr of remaining) await saveResult(rr);
            setPendingResults([]);
            setProcessingFiles([]);
            setIsProcessing(false);
          },
        });
        return; // dừng, chờ người dùng xử lý
      }
    }

    setIsProcessing(true);
    const resultsToSave = [...latestPending];
    
    for (const r of resultsToSave) {
      await saveResult(r, true); // đã validate ở trên rồi
    }
    
    setPendingResults([]);
    setProcessingFiles([]);
    setCurrentResult(null);
    setIsProcessing(false);
    alert(`✅ Đã lưu thành công ${resultsToSave.length} biên bản!`);
  };

  const cancelResult = (id: string) => {
    setPendingResults(prev => prev.filter(r => r.id !== id));
    if (currentResult?.id === id) {
      setCurrentResult(null);
    }
  };

  const handleDelete = (id: string) => {
    const itemToDelete = history.find(item => item.id === id);
    const filesToDelete: string[] = [];
    if (itemToDelete?.fileUrl)  filesToDelete.push(`📄 File ảnh/PDF: ${itemToDelete.fileName || 'file gốc'}`);
    if (itemToDelete?.excelUrl) filesToDelete.push(`📊 File Excel: ${itemToDelete.excelUrl.split('/').pop()}`);

    setConfirmDialog({
      title: 'Xác nhận xóa biên bản',
      message: `Biên bản: ${itemToDelete?.componentName || ''} — ${itemToDelete?.pileId || ''}`,
      detail: filesToDelete.length > 0
        ? `Các file sẽ bị xóa trên GitHub:\n${filesToDelete.join('\n')}\n\n⚠️ Hành động này KHÔNG THỂ hoàn tác.`
        : '⚠️ Hành động này KHÔNG THỂ hoàn tác.',
      type: 'delete',
      onConfirm: async () => {
        setConfirmDialog(null);
        // Optimistic UI
        setHistory(prev => prev.filter(item => item.id !== id));
        if (currentResult?.id === id) setCurrentResult(null);
        showToast('Đang xóa dữ liệu...', 'loading');

        const errors: string[] = [];

        // 1. Xóa Supabase TRƯỚC — chờ xong mới tiếp tục
        if (supabase) {
          try {
            const { error } = await supabase.from('drill_extractions').delete().eq('id', id);
            if (error) errors.push(`Supabase: ${error.message}`);
          } catch (e: any) {
            errors.push(`Supabase: ${e?.message}`);
          }
        }

        // 2. Xóa file GitHub (chạy sau Supabase)
        if (githubCreds && itemToDelete) {
          const urlsToDelete = [itemToDelete.fileUrl, itemToDelete.excelUrl].filter(Boolean) as string[];
          for (const url of urlsToDelete) {
            try {
              await deleteGithubFile(url, githubCreds);
            } catch (e: any) {
              errors.push(`GitHub (${url.split('/').pop()}): ${e?.message}`);
            }
          }
        }

        // 3. Đồng bộ localStorage
        try {
          const saved = localStorage.getItem('pile_drill_history');
          if (saved) {
            localStorage.setItem('pile_drill_history', JSON.stringify(
              JSON.parse(saved).filter((r: any) => r.id !== id)
            ));
          }
        } catch {}

        // 4. Thông báo kết quả
        if (errors.length > 0) {
          showToast(`⚠️ Xóa một phần — có lỗi: ${errors[0]}`, 'error', 6000);
        } else {
          showToast('✅ Đã xóa và đồng bộ dữ liệu thành công!', 'success', 3500);
        }
      },
    });
  };

  const handleEdit = async (result: ExtractionResult) => {
    // Nếu layers chưa có (lazy-load), fetch từ Supabase trước khi mở modal
    let safeResult = { ...result, layers: Array.isArray(result.layers) ? result.layers : [] };
    if (safeResult.layers.length === 0 && supabase) {
      try {
        const { data } = await supabase
          .from('drill_extractions')
          .select('layers')
          .eq('id', result.id)
          .single();
        if (data?.layers && Array.isArray(data.layers) && data.layers.length > 0) {
          const cleanLayers = data.layers.map((l: any) => sanitizeLayer(l));
          safeResult = { ...safeResult, layers: cleanLayers };
          // Cập nhật lại history state để lần sau không cần fetch lại
          setHistory(prev => prev.map(r => r.id === result.id ? { ...r, layers: cleanLayers } : r));
        }
      } catch (e) {
        console.warn('[handleEdit] Không thể lazy-load layers:', e);
      }
    }
    setEditingResult(JSON.parse(JSON.stringify(safeResult)));
    setIsEditModalOpen(true);
  };

  const handleRefreshExcel = async (item: ExtractionResult) => {
    if (!isGithubConnected || !githubCreds) {
      alert("⚠️ Vui lòng kết nối GitHub trong cài đặt để thực hiện chức năng này.");
      return;
    }

    try {
      const autoImg = await ensureImageData(item, githubCreds);
      const excelBase64 = await generateExcelBase64(item, autoImg);
      
      if (excelBase64) {
        const newUrl = await upsertExcelToGitHub(item.id, excelBase64, githubCreds, item.excelUrl, item);
        if (newUrl) {
          if (supabase) {
             await supabase.from('drill_extractions').update({ excelUrl: newUrl }).eq('id', item.id);
          }
          setHistory(prev => prev.map(r => r.id === item.id ? { ...r, excelUrl: newUrl } : r));
          alert("✅ Đã làm mới file Excel thành công!");
        }
      }
    } catch (e) {
      console.error("Refresh Excel failed:", e);
      alert("❌ Lỗi khi làm mới file Excel.");
    }
  };

  // Tải Excel ngay tại browser: fetch ảnh → tạo Excel với ảnh → download
  // Đảm bảo luôn có ảnh dù file trên GitHub thiếu ảnh
  const handleDownloadExcel = async (item: ExtractionResult) => {
    setDownloadingExcelId(item.id);
    try {
      // Lấy ảnh với nhiều fallback (proxy → trực tiếp → GitHub API)
      const autoImg = await ensureImageData(item, githubCreds);
      
      // Tạo Excel buffer ngay trong browser rồi download
      const ExcelJS = await loadExcelJS();
      const argb = (hex: string) => 'FF' + hex.toUpperCase();
      const thinBorder = (color = 'CCCCCC') => ({
        top: { style: 'thin' as const, color: { argb: argb(color) } },
        bottom: { style: 'thin' as const, color: { argb: argb(color) } },
        left: { style: 'thin' as const, color: { argb: argb(color) } },
        right: { style: 'thin' as const, color: { argb: argb(color) } },
      });
      const applyCell = (cell: any, value: any, opts: { bg?: string; fontColor?: string; bold?: boolean; sz?: number; align?: string; wrap?: boolean; border?: any }) => {
        cell.value = value;
        cell.font = { name: 'Arial', size: opts.sz ?? 10, bold: opts.bold ?? false, color: { argb: argb(opts.fontColor ?? '000000') } };
        if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(opts.bg) } };
        cell.alignment = { horizontal: (opts.align ?? 'center') as any, vertical: 'middle', wrapText: opts.wrap ?? false };
        cell.border = opts.border ?? thinBorder();
      };

      const wb = new ExcelJS.Workbook();
      wb.creator = 'SGC-CKN'; wb.created = new Date();

      let gc = 0; let pk = '';
      const rowColorIdx = item.layers.map((layer) => {
        const key = layer.layerDesign?.trim() || '__';
        if (key !== pk) { gc++; pk = key; }
        return Math.max(0, gc - 1) % GROUP_COLORS.length;
      });

      // Sheet 1: Chi tiết địa chất
      const ws1 = wb.addWorksheet('Chi tiết địa chất');
      ws1.columns = [
        { width: 14 }, { width: 11 }, { width: 46 }, { width: 13 }, { width: 13 },
        { width: 11 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 28 },
      ];
      const infoItems = [
        ['Dự án', item.project], ['Hạng mục', item.item],
        ['Tên bộ phận', item.componentName], ['Số hiệu cọc', item.pileId],
        ['Tên Máy khoan', item.reportNumber], ['Đường kính', item.diameter],
        ['Bắt đầu thi công', item.constructionStart], ['Kết thúc thi công', item.constructionEnd],
      ];
      infoItems.forEach(([k, v]) => {
        const row = ws1.addRow([k, v]);
        row.height = 18;
        applyCell(row.getCell(1), k, { bg: 'EFF6FF', fontColor: '1E3A6E', bold: true, align: 'left', border: thinBorder('DBEAFE') });
        applyCell(row.getCell(2), v, { bg: 'FFFFFF', fontColor: '374151', align: 'left', border: thinBorder('DBEAFE') });
        ws1.mergeCells(row.number, 2, row.number, 11);
      });
      const blankRow = ws1.addRow([]); blankRow.height = 6;
      const hdrCols = ['Địa chất TT', 'Đường kính', 'Mô tả lớp thiết kế', 'Từ (h)', 'Đến (h)', 'Cao độ từ', 'Cao độ đến', 'T.Gian (h)', 'Dài (m)', 'V (m/h)', 'Ghi chú'];
      const hdrRow = ws1.addRow(hdrCols);
      hdrRow.height = 36;
      hdrCols.forEach((h, ci) => {
        applyCell(hdrRow.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 || ci === 10 ? 'left' : 'center', wrap: true, border: thinBorder('FFFFFF') });
      });
      item.layers.forEach((layer, ri) => {
        const { bg, font: fontColor } = GROUP_COLORS[rowColorIdx[ri]];
        const spd = layer.speedMph;
        const isSlowSpd = spd > 0 && spd <= 1;
        const spdBg = isSlowSpd ? 'DC2626' : spd > 5 ? 'D1FAE5' : 'FFF7ED';
        const spdFontColor = isSlowSpd ? 'FFFFFF' : 'C2410C';
        const vals = [
          getGeoDisplay(layer), item.diameter, layer.layerDesign,
          layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
          layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
          layer.elevationFrom, layer.elevationTo,
          parseFloat(toNum(layer.durationHours).toFixed(2)),
          parseFloat(toNum(layer.lengthMeters).toFixed(2)),
          parseFloat(spd.toFixed(2)),
          layer.notes || '',
        ];
        const dataRow = ws1.addRow(vals);
        dataRow.height = 36;
        vals.forEach((v, ci) => {
          const isSpd = ci === 9;
          applyCell(dataRow.getCell(ci + 1), v, {
            bg: isSpd ? spdBg : bg,
            fontColor: isSpd ? spdFontColor : fontColor,
            bold: isSpd && isSlowSpd,
            align: ci === 2 || ci === 10 ? 'left' : 'center',
            wrap: ci === 2 || ci === 3 || ci === 4 || ci === 10,
            border: thinBorder(),
          });
        });
      });

      // Nhúng ảnh
      if (autoImg) {
        try {
          const imgId = wb.addImage({ base64: autoImg.base64, extension: autoImg.ext as any });
          const startRow = 11 + item.layers.length + 2;
          const titleRow = ws1.getRow(startRow);
          titleRow.height = 25;
          applyCell(titleRow.getCell(1), 'ẢNH BIÊN BẢN GỐC', { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 12, align: 'center', border: thinBorder('1A3A6B') });
          ws1.mergeCells(startRow, 1, startRow, 11);
          ws1.addImage(imgId, { tl: { col: 0, row: startRow }, ext: { width: 850, height: 1100 } });
          for (let i = startRow + 1; i <= startRow + 60; i++) ws1.getRow(i).height = 20;
        } catch (imgErr) {
          console.error('[handleDownloadExcel] Lỗi nhúng ảnh vào Excel:', imgErr);
          // Tiếp tục xuất Excel dù lỗi ảnh
        }
      } else {
        const startRow = 11 + item.layers.length + 2;
        const titleRow = ws1.getRow(startRow);
        titleRow.height = 25;
        applyCell(titleRow.getCell(1), '⚠️ CẢNH BÁO: THIẾU HÌNH ẢNH BIÊN BẢN GỐC TRONG DỮ LIỆU', { bg: 'FEE2E2', fontColor: '991B1B', bold: true, sz: 12, align: 'center', border: thinBorder('991B1B') });
        ws1.mergeCells(startRow, 1, startRow, 11);
      }

      // Sheet 2: Tổng hợp lớp thiết kế
      const ws2 = wb.addWorksheet('Tổng hợp lớp thiết kế');
      ws2.columns = [{ width: 6 }, { width: 11 }, { width: 46 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 }];
      const hdr2 = ['STT', 'Đường kính', 'Lớp Thiết Kế', 'Số đoạn', 'Cao độ từ (m)', 'Cao độ đến (m)', 'Tổng T.Gian (h)', 'Tổng Dài (m)', 'V TB (m/h)'];
      const hdrRow2 = ws2.addRow(hdr2);
      hdrRow2.height = 36;
      hdr2.forEach((h, ci) => {
        applyCell(hdrRow2.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 ? 'left' : 'center', wrap: true, border: thinBorder('FFFFFF') });
      });
      const groups2: any[] = [];
      let gc2b = 0; let pk2b = '';
      item.layers.forEach((layer) => {
        const key = layer.layerDesign?.trim() || '(Chưa có)';
        if (key !== pk2b) { gc2b++; pk2b = key; }
        const ci2 = Math.max(0, gc2b - 1) % GROUP_COLORS.length;
        const last = groups2[groups2.length - 1];
        if (last && last.layerDesign === key) {
          last.segments++; last.elevationTo = layer.elevationTo;
          last.totalDuration += layer.durationHours; last.totalLength += layer.lengthMeters;
        } else {
          groups2.push({ layerDesign: key, segments: 1, elevationFrom: layer.elevationFrom, elevationTo: layer.elevationTo, totalDuration: layer.durationHours, totalLength: layer.lengthMeters, colorIdx: ci2 });
        }
      });
      groups2.forEach(g => { g.avgSpeed = g.totalDuration > 0 ? g.totalLength / g.totalDuration : 0; });
      const totalDur2 = groups2.reduce((s, g) => s + g.totalDuration, 0);
      const totalLen2b = groups2.reduce((s, g) => s + g.totalLength, 0);
      const totalAvgSpd2 = totalDur2 > 0 ? totalLen2b / totalDur2 : 0;
      groups2.forEach((g, i) => {
        const { bg, font: fontColor } = GROUP_COLORS[g.colorIdx];
        const isSlowSpd = g.avgSpeed > 0 && g.avgSpeed <= 1;
        const spdBg = isSlowSpd ? 'DC2626' : g.avgSpeed > 5 ? 'D1FAE5' : 'FFF7ED';
        const vals2 = [i + 1, item.diameter, g.layerDesign, g.segments, parseFloat(toNum(g.elevationFrom).toFixed(2)), parseFloat(toNum(g.elevationTo).toFixed(2)), parseFloat(g.totalDuration.toFixed(2)), parseFloat(g.totalLength.toFixed(2)), parseFloat(g.avgSpeed.toFixed(2))];
        const r2 = ws2.addRow(vals2);
        r2.height = 32;
        vals2.forEach((v, ci) => {
          const isSpd = ci === 8;
          applyCell(r2.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? (isSlowSpd ? 'FFFFFF' : 'C2410C') : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 ? 'left' : 'center', wrap: ci === 2, border: thinBorder() });
        });
      });
      const totVals2 = ['TỔNG CỘNG', '', '', item.layers.length,
        item.layers.length > 0 ? parseFloat(toNum(item.layers[0].elevationFrom).toFixed(2)) : '',
        item.layers.length > 0 ? parseFloat(toNum(item.layers[item.layers.length - 1].elevationTo).toFixed(2)) : '',
        parseFloat(totalDur2.toFixed(2)), parseFloat(totalLen2b.toFixed(2)), parseFloat(totalAvgSpd2.toFixed(2))];
      const totRow2 = ws2.addRow(totVals2);
      totRow2.height = 28;
      totVals2.forEach((v, ci) => {
        applyCell(totRow2.getCell(ci + 1), v, { bg: 'E2E8F0', fontColor: '1E3A6E', bold: true, sz: 11, align: ci === 0 ? 'left' : 'center', border: { ...thinBorder(), top: { style: 'medium' as const, color: { argb: argb('1E3A6E') } } } });
      });

      // Xuất file
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `${buildExcelFileName(item)}.xlsx`;
      a.click();
      URL.revokeObjectURL(dlUrl);
    } catch (e) {
      console.error('[handleDownloadExcel] Lỗi:', e);
      alert('❌ Không thể tải file Excel. Vui lòng thử lại hoặc kiểm tra kết nối mạng.');
    } finally {
      setDownloadingExcelId(null);
    }
  };

  // Xuất Excel tổng hợp — nhúng ảnh của từng biên bản vào sheet riêng
  const exportAllToExcel = async (rows: ExtractionResult[]) => {
    setIsExportingAll(true);
    try {
      const ExcelJS = await loadExcelJS();
      const argb = (hex: string) => 'FF' + hex.toUpperCase();
      const thin = (c = 'D1D5DB') => ({ style: 'thin' as const, color: { argb: argb(c) } });
      const border = (c = 'D1D5DB') => ({ top: thin(c), bottom: thin(c), left: thin(c), right: thin(c) });
      const cell = (c: any, v: any, bg?: string, fc = '1E293B', bold = false, align: any = 'left', sz = 10, wrap = false) => {
        c.value = v ?? '';
        c.font = { name: 'Arial', size: sz, bold, color: { argb: argb(fc) } };
        if (bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(bg) } };
        c.alignment = { horizontal: align, vertical: 'middle', wrapText: wrap };
        c.border = border();
      };

      const wb = new ExcelJS.Workbook();
      wb.creator = 'SGC-CKN'; wb.created = new Date();

      // ── Sheet 0: Dữ liệu thi công ──
      const ws0 = wb.addWorksheet('Dữ liệu thi công');
      ws0.columns = [
        { width: 8 }, { width: 30 }, { width: 25 }, { width: 25 }, { width: 12 },
        { width: 15 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 15 },
        { width: 15 }, { width: 15 }, { width: 20 },
      ];
      const r0_1 = ws0.addRow(['BẢNG TỔNG HỢP DỮ LIỆU THI CÔNG']);
      r0_1.height = 30;
      cell(r0_1.getCell(1), r0_1.getCell(1).value, '1E3A6E', 'FFFFFF', true, 'center', 14);
      ws0.mergeCells(r0_1.number, 1, r0_1.number, 13);
      const HDRS0 = ['STT', 'Dự án', 'Hạng mục', 'Tên bộ phận', 'Số hiệu', 'Tên Máy khoan', 'Đường kính', 'Bắt đầu', 'Kết thúc', 'Chiều dài (m)', 'T.Gian TC (h)', 'Vận tốc TB (m/h)', 'Sheet ảnh'];
      const r0_2 = ws0.addRow(HDRS0);
      r0_2.height = 25;
      HDRS0.forEach((h, ci) => cell(r0_2.getCell(ci + 1), h, '1E3A6E', 'FFFFFF', true, 'center', 10, true));
      ws0.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 13 } };

      rows.forEach((res, idx) => {
        const reportStt = (res as any).displayStt || (rows.length - idx);
        const totalLen = (res.layers || []).reduce((acc, l) => acc + l.lengthMeters, 0);
        const totalDur = (res.layers || []).reduce((acc, l) => acc + l.durationHours, 0);
        const avgSpeed = totalDur > 0 ? totalLen / totalDur : 0;
        // Tên sheet ảnh cho biên bản này
        const sheetName = `BB${reportStt}_${(res.pileId || '').replace(/[^\w]/g, '').slice(0, 10)}`;
        const row = ws0.addRow([
          reportStt, res.project, res.item, res.componentName, res.pileId,
          res.reportNumber, res.diameter, res.constructionStart, res.constructionEnd,
          parseFloat(totalLen.toFixed(2)), parseFloat(totalDur.toFixed(2)), parseFloat(avgSpeed.toFixed(2)),
          { text: `→ ${sheetName}`, hyperlink: `#'${sheetName}'!A1` }
        ]);
        for (let ci = 1; ci <= 13; ci++) {
          const c = row.getCell(ci);
          const isText = [2, 3, 4, 6].includes(ci);
          const isLink = ci === 13;
          cell(c, c.value, undefined, isLink ? '2563EB' : '1E293B', isLink, isText ? 'left' : 'center', 9, isText);
          if (isLink) c.font = { ...c.font, underline: true };
        }
      });

      // ── Sheet 1: Chi tiết Các lớp địa chất ──
      const ws1 = wb.addWorksheet('Chi tiết Các lớp địa chất');
      ws1.columns = [
        { width: 6 }, { width: 25 }, { width: 25 }, { width: 25 }, { width: 10 },
        { width: 12 }, { width: 10 }, { width: 12 }, { width: 40 }, { width: 18 },
        { width: 18 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 10 },
        { width: 10 }, { width: 20 },
      ];
      const r1_1 = ws1.addRow(['CHI TIẾT CÁC LỚP ĐỊA CHẤT - TẤT CẢ BIÊN BẢN']);
      r1_1.height = 30;
      cell(r1_1.getCell(1), r1_1.getCell(1).value, '1E3A6E', 'FFFFFF', true, 'center', 14);
      ws1.mergeCells(r1_1.number, 1, r1_1.number, 17);
      const HDRS1 = ['STT', 'Dự án', 'Hạng mục', 'Tên bộ phận', 'Số hiệu', 'Tên Máy khoan', 'ĐC thực tế', 'Đường kính', 'Mô tả lớp thiết kế', 'Từ (h)', 'Đến (h)', 'Cao độ từ', 'Cao độ đến', 'T.Gian (h)', 'Dài (m)', 'V (m/h)', 'Ghi chú'];
      const r2_1 = ws1.addRow(HDRS1);
      r2_1.height = 25;
      HDRS1.forEach((h, ci) => cell(r2_1.getCell(ci + 1), h, '1E3A6E', 'FFFFFF', true, 'center', 10, true));
      ws1.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 17 } };
      [2, 3, 4, 6, 9, 17].forEach(col => {
        ws1.getColumn(col).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      });
      rows.forEach((res, idx) => {
        const reportStt = (res as any).displayStt || (rows.length - idx);
        (res.layers || []).forEach((layer) => {
          const row = ws1.addRow([
            reportStt, res.project, res.item, res.componentName, res.pileId,
            res.reportNumber, getGeoDisplay(layer), res.diameter, layer.layerDesign,
            layer.timeFrom + ' ' + layer.dateFrom, layer.timeTo + ' ' + layer.dateTo,
            layer.elevationFrom, layer.elevationTo,
            parseFloat(toNum(layer.durationHours).toFixed(2)), parseFloat(toNum(layer.lengthMeters).toFixed(2)),
            parseFloat(toNum(layer.speedMph).toFixed(2)), layer.notes,
          ]);
          const wrapCols = [2, 3, 4, 6, 9, 17];
          for (let ci = 1; ci <= 17; ci++) {
            const c = row.getCell(ci);
            const shouldWrap = wrapCols.includes(ci);
            cell(c, c.value, undefined, '1E293B', false, shouldWrap ? 'left' : 'center', 9, shouldWrap);
          }
        });
      });

      // ── Sheet 2: Thống kê theo từng biên bản ──
      const ws2 = wb.addWorksheet('Thống kê theo từng biên bản');
      ws2.columns = [
        { width: 6 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 10 },
        { width: 12 }, { width: 12 }, { width: 12 }, { width: 40 }, { width: 10 },
        { width: 12 }, { width: 12 }, { width: 12 },
      ];
      const r1_2 = ws2.addRow(['THỐNG KÊ THEO LỚP THIẾT KẾ - TỪNG BIÊN BẢN']);
      r1_2.height = 30;
      cell(r1_2.getCell(1), r1_2.getCell(1).value, '1E3A6E', 'FFFFFF', true, 'center', 14);
      ws2.mergeCells(r1_2.number, 1, r1_2.number, 13);
      const HDRS2 = ['STT', 'Dự án', 'Hạng mục', 'Tên bộ phận', 'Số hiệu', 'Tên Máy khoan', 'Đường kính', 'Ký hiệu ĐC', 'Mô tả lớp thiết kế', 'Số mẫu', 'Tổng Dài (m)', 'Tổng T.Gian (h)', 'V.TB (m/h)'];
      const r2_2 = ws2.addRow(HDRS2);
      r2_2.height = 25;
      HDRS2.forEach((h, ci) => cell(r2_2.getCell(ci + 1), h, '1E3A6E', 'FFFFFF', true, 'center', 10, true));
      ws2.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 13 } };
      [2, 3, 4, 6, 9].forEach(col => {
        ws2.getColumn(col).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      });
      rows.forEach((res, idx) => {
        const reportStt = (res as any).displayStt || (rows.length - idx);
        const perReportStats: Record<string, any> = {};
        (res.layers || []).forEach(layer => {
          const key = `${layer.designLayerCode}|||${layer.layerDesign}`;
          if (!perReportStats[key]) {
            perReportStats[key] = { code: layer.designLayerCode, design: layer.layerDesign, segments: 0, totalLen: 0, totalDur: 0 };
          }
          perReportStats[key].segments++;
          perReportStats[key].totalLen += layer.lengthMeters;
          perReportStats[key].totalDur += layer.durationHours;
        });
        Object.values(perReportStats).forEach((stat: any) => {
          const avg = stat.totalDur > 0 ? stat.totalLen / stat.totalDur : 0;
          const row = ws2.addRow([
            reportStt, res.project, res.item, res.componentName, res.pileId,
            res.reportNumber, res.diameter, stat.code, stat.design, stat.segments,
            parseFloat(stat.totalLen.toFixed(2)), parseFloat(stat.totalDur.toFixed(2)), parseFloat(avg.toFixed(2)),
          ]);
          const wrapCols = [2, 3, 4, 6, 9];
          for (let ci = 1; ci <= 13; ci++) {
            const c = row.getCell(ci);
            const shouldWrap = wrapCols.includes(ci);
            cell(c, c.value, undefined, '1E293B', false, shouldWrap ? 'left' : 'center', 9, shouldWrap);
          }
        });
      });

      // ── Sheet 3: Tổng hợp lớp thiết kế ──
      const ws3 = wb.addWorksheet('Tổng hợp lớp thiết kế');
      ws3.columns = [
        { width: 6 }, { width: 15 }, { width: 15 }, { width: 45 }, { width: 10 },
        { width: 10 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 },
      ];
      const r1_3 = ws3.addRow(['TỔNG HỢP THỐNG KÊ THEO LỚP THIẾT KẾ - TOÀN BỘ']);
      r1_3.height = 30;
      cell(r1_3.getCell(1), r1_3.getCell(1).value, '1E3A6E', 'FFFFFF', true, 'center', 14);
      ws3.mergeCells(r1_3.number, 1, r1_3.number, 11);
      const HDRS3 = ['STT', 'Đường kính', 'Ký hiệu ĐC', 'Mô tả lớp thiết kế tương ứng', 'Số cọc', 'Số mẫu', 'Tổng Dài (m)', 'Tổng T.Gian (h)', 'V.Min (m/h)', 'V.Max (m/h)', 'V.TB (m/h)'];
      const r2_3 = ws3.addRow(HDRS3);
      r2_3.height = 25;
      HDRS3.forEach((h, ci) => cell(r2_3.getCell(ci + 1), h, '1E3A6E', 'FFFFFF', true, 'center', 10, true));
      ws3.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 11 } };
      ws3.getColumn(4).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      const excelStatsMap: Record<string, any> = {};
      const normalizeForGrouping = (str: string) => {
        if (!str) return '';
        return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');
      };
      rows.forEach(res => {
        (res.layers || []).forEach(layer => {
          const code = (layer.designLayerCode || '').trim();
          const design = (layer.layerDesign || 'Chưa xác định').trim();
          const dia = (res.diameter || '—').trim();
          const key = `${normalizeForGrouping(design)}|||${normalizeForGrouping(dia)}`;
          if (!excelStatsMap[key]) {
            excelStatsMap[key] = { code, design, dia, pileIds: new Set(), segments: 0, minSpeed: Infinity, maxSpeed: -Infinity, totalDuration: 0, totalLength: 0 };
          }
          const s = excelStatsMap[key];
          s.pileIds.add((res.pileId || res.id).trim());
          s.segments += 1; s.totalDuration += layer.durationHours; s.totalLength += layer.lengthMeters;
          if (layer.speedMph > 0) {
            if (layer.speedMph < s.minSpeed) s.minSpeed = layer.speedMph;
            if (layer.speedMph > s.maxSpeed) s.maxSpeed = layer.speedMph;
          }
        });
      });
      const excelStats = Object.values(excelStatsMap).sort((a, b) => {
        if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
        return a.design.localeCompare(b.design);
      });
      excelStats.forEach((stat, idx) => {
        const avg = stat.totalDuration > 0 ? stat.totalLength / stat.totalDuration : 0;
        const row = ws3.addRow([
          idx + 1, stat.dia, stat.code || '—', stat.design, stat.pileIds.size, stat.segments,
          parseFloat(stat.totalLength.toFixed(2)), parseFloat(stat.totalDuration.toFixed(2)),
          stat.minSpeed === Infinity ? '—' : parseFloat(stat.minSpeed.toFixed(2)),
          stat.maxSpeed === -Infinity ? '—' : parseFloat(stat.maxSpeed.toFixed(2)),
          parseFloat(avg.toFixed(2))
        ]);
        row.eachCell((c, ci) => {
          const shouldWrap = ci === 4;
          cell(c, c.value, undefined, '1E293B', false, shouldWrap ? 'left' : 'center', 9, shouldWrap);
        });
      });
      const totalPilesCount3 = rows.length;
      let totalSegs3 = 0, totalLen3 = 0, totalDur3 = 0, gMin3 = Infinity, gMax3 = -Infinity;
      excelStats.forEach(s => {
        totalSegs3 += s.segments; totalLen3 += s.totalLength; totalDur3 += s.totalDuration;
        if (s.minSpeed < gMin3) gMin3 = s.minSpeed;
        if (s.maxSpeed > gMax3) gMax3 = s.maxSpeed;
      });
      const totalAvg3 = totalDur3 > 0 ? totalLen3 / totalDur3 : 0;
      const footer3 = ws3.addRow(['TỔNG CỘNG', '', '', '', totalPilesCount3, totalSegs3, parseFloat(totalLen3.toFixed(2)), parseFloat(totalDur3.toFixed(2)), gMin3 === Infinity ? '—' : parseFloat(gMin3.toFixed(2)), gMax3 === -Infinity ? '—' : parseFloat(gMax3.toFixed(2)), parseFloat(totalAvg3.toFixed(2))]);
      footer3.height = 24;
      ws3.mergeCells(footer3.number, 1, footer3.number, 4);
      footer3.eachCell((c, ci) => {
        cell(c, c.value, 'E2E8F0', '1E3A6E', true, 'center', 10);
        if (ci === 1) c.alignment = { horizontal: 'right', vertical: 'middle' };
      });

      // ── Sheet ảnh riêng cho từng biên bản (fetch ảnh song song, giới hạn 5 cùng lúc) ──
      const applySheetCell = (c: any, v: any, opts: { bg?: string; fontColor?: string; bold?: boolean; sz?: number; align?: string; wrap?: boolean }) => {
        c.value = v;
        c.font = { name: 'Arial', size: opts.sz ?? 10, bold: opts.bold ?? false, color: { argb: argb(opts.fontColor ?? '000000') } };
        if (opts.bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(opts.bg) } };
        c.alignment = { horizontal: (opts.align ?? 'center') as any, vertical: 'middle', wrapText: opts.wrap ?? false };
        c.border = { top: thin(), bottom: thin(), left: thin(), right: thin() };
      };
      const thinB = (color = 'CCCCCC') => ({
        top: { style: 'thin' as const, color: { argb: argb(color) } },
        bottom: { style: 'thin' as const, color: { argb: argb(color) } },
        left: { style: 'thin' as const, color: { argb: argb(color) } },
        right: { style: 'thin' as const, color: { argb: argb(color) } },
      });

      // Fetch ảnh song song (tối đa 5 cùng lúc để không bị rate limit)
      const CHUNK = 5;
      const imageResults: ({ base64: string; ext: string } | null)[] = new Array(rows.length).fill(null);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const fetched = await Promise.all(chunk.map(res => ensureImageData(res, githubCreds).catch(() => null)));
        fetched.forEach((img, j) => { imageResults[i + j] = img; });
      }

      // Tạo sheet cho từng biên bản
      rows.forEach((res, idx) => {
        const reportStt = (res as any).displayStt || (rows.length - idx);
        // Tên sheet: tối đa 31 ký tự, không có ký tự đặc biệt
        const rawName = `BB${reportStt}_${(res.pileId || '').replace(/[^\w]/g, '').slice(0, 10)}`;
        const sheetName = rawName.slice(0, 31);
        const wsImg = wb.addWorksheet(sheetName);
        wsImg.columns = [
          { width: 14 }, { width: 11 }, { width: 46 }, { width: 13 }, { width: 13 },
          { width: 11 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 28 },
        ];

        // Nút quay lại sheet Dữ liệu thi công
        const backRow = wsImg.addRow([]);
        backRow.height = 24;
        const backCell = backRow.getCell(1);
        backCell.value = { text: '← Quay lại Dữ liệu thi công', hyperlink: `#'Dữ liệu thi công'!A1` };
        backCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' }, underline: false };
        backCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A6B' } };
        backCell.alignment = { horizontal: 'center', vertical: 'middle' };
        backCell.border = thinB();
        wsImg.mergeCells(backRow.number, 1, backRow.number, 11);
        const blankBack = wsImg.addRow([]); blankBack.height = 6;

        // Thông tin biên bản
        const infoItems = [
          ['Dự án', res.project], ['Hạng mục', res.item],
          ['Tên bộ phận', res.componentName], ['Số hiệu cọc', res.pileId],
          ['Tên Máy khoan', res.reportNumber], ['Đường kính', res.diameter],
          ['Bắt đầu thi công', res.constructionStart], ['Kết thúc thi công', res.constructionEnd],
        ];
        infoItems.forEach(([k, v]) => {
          const row = wsImg.addRow([k, v]);
          row.height = 18;
          applySheetCell(row.getCell(1), k, { bg: 'EFF6FF', fontColor: '1E3A6E', bold: true, align: 'left' });
          applySheetCell(row.getCell(2), v, { bg: 'FFFFFF', fontColor: '374151', align: 'left' });
          wsImg.mergeCells(row.number, 2, row.number, 11);
        });
        const blankR = wsImg.addRow([]); blankR.height = 6;

        // Header bảng lớp địa chất
        const hdrCols = ['Địa chất TT', 'Đường kính', 'Mô tả lớp thiết kế', 'Từ (h)', 'Đến (h)', 'Cao độ từ', 'Cao độ đến', 'T.Gian (h)', 'Dài (m)', 'V (m/h)', 'Ghi chú'];
        const hdrRow = wsImg.addRow(hdrCols);
        hdrRow.height = 36;
        hdrCols.forEach((h, ci) => {
          applySheetCell(hdrRow.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 || ci === 10 ? 'left' : 'center', wrap: true });
        });

        // Dữ liệu lớp địa chất
        let gc = 0; let pk = '';
        const rowColorIdx = (res.layers || []).map((layer) => {
          const key = layer.layerDesign?.trim() || '__';
          if (key !== pk) { gc++; pk = key; }
          return Math.max(0, gc - 1) % GROUP_COLORS.length;
        });
        (res.layers || []).forEach((layer, ri) => {
          const { bg, font: fontColor } = GROUP_COLORS[rowColorIdx[ri]];
          const spd = layer.speedMph;
          const isSlowSpd = spd > 0 && spd <= 1;
          const spdBg = isSlowSpd ? 'DC2626' : spd > 5 ? 'D1FAE5' : 'FFF7ED';
          const spdFontColor = isSlowSpd ? 'FFFFFF' : 'C2410C';
          const vals = [
            getGeoDisplay(layer), res.diameter, layer.layerDesign,
            layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
            layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
            layer.elevationFrom, layer.elevationTo,
            parseFloat(toNum(layer.durationHours).toFixed(2)),
            parseFloat(toNum(layer.lengthMeters).toFixed(2)),
            parseFloat(spd.toFixed(2)),
            layer.notes || '',
          ];
          const dataRow = wsImg.addRow(vals);
          dataRow.height = 36;
          vals.forEach((v, ci) => {
            const isSpd = ci === 9;
            const c = dataRow.getCell(ci + 1);
            c.value = v;
            c.font = { name: 'Arial', size: 10, bold: isSpd && isSlowSpd, color: { argb: argb(isSpd ? spdFontColor : fontColor) } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(isSpd ? spdBg : bg) } };
            c.alignment = { horizontal: (ci === 2 || ci === 10 ? 'left' : 'center') as any, vertical: 'middle', wrapText: ci === 2 || ci === 3 || ci === 4 || ci === 10 };
            c.border = thinB();
          });
        });

        // Nhúng ảnh biên bản
        const imgData = imageResults[idx];
        const startRow = 11 + (res.layers || []).length + 2;
        if (imgData) {
          try {
            const imgId = wb.addImage({ base64: imgData.base64, extension: imgData.ext as any });
            const titleRow = wsImg.getRow(startRow);
            titleRow.height = 25;
            applySheetCell(titleRow.getCell(1), 'ẢNH BIÊN BẢN GỐC', { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 12, align: 'center' });
            wsImg.mergeCells(startRow, 1, startRow, 11);
            wsImg.addImage(imgId, { tl: { col: 0, row: startRow }, ext: { width: 850, height: 1100 } });
            for (let i = startRow + 1; i <= startRow + 60; i++) wsImg.getRow(i).height = 20;
          } catch (imgErr) {
            console.error(`[exportAllToExcel] Lỗi nhúng ảnh biên bản ${res.pileId}:`, imgErr);
          }
        } else {
          const titleRow = wsImg.getRow(startRow);
          titleRow.height = 25;
          applySheetCell(titleRow.getCell(1), '⚠️ CẢNH BÁO: THIẾU HÌNH ẢNH BIÊN BẢN GỐC', { bg: 'FEE2E2', fontColor: '991B1B', bold: true, sz: 12, align: 'center' });
          wsImg.mergeCells(startRow, 1, startRow, 11);
        }
      });

      // Xuất file
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      const dateStr = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
      a.download = `SGC-CKN_TongHop_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    } catch (err: any) {
      console.error('exportAllToExcel error:', err);
      alert('❌ Lỗi khi xuất Excel tổng hợp: ' + (err?.message || 'Vui lòng thử lại.'));
    } finally {
      setIsExportingAll(false);
    }
  };

  const handleSaveEdit = (updatedResult: ExtractionResult) => {
    setConfirmDialog({
      title: 'Xác nhận lưu thay đổi',
      message: 'Bạn có chắc chắn muốn cập nhật biên bản này không?',
      detail: `${updatedResult.componentName || ''} — ${updatedResult.pileId || ''}`,
      type: 'save',
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsEditModalOpen(false);
        setEditingResult(null);
        setHistory(prev => prev.map(item => item.id === updatedResult.id ? updatedResult : item));

        let finalResult = { ...updatedResult };
        showToast('Đang đồng bộ dữ liệu...', 'loading');

        // 1. Tái tạo Excel trên GitHub
        if (isGithubConnected && githubCreds) {
          try {
            const autoImg = await ensureImageData(finalResult, githubCreds);
            const excelBase64 = await generateExcelBase64(finalResult, autoImg);
            if (excelBase64) {
              const newUrl = await upsertExcelToGitHub(finalResult.id, excelBase64, githubCreds, finalResult.excelUrl, finalResult);
              if (newUrl) {
                finalResult = { ...finalResult, excelUrl: newUrl };
                setHistory(prev => prev.map(item => item.id === finalResult.id ? { ...item, excelUrl: newUrl } : item));
              }
            }
          } catch (e) {
            console.error('Re-generate Excel on edit failed:', e);
          }
        }

        // 2. Update Supabase
        if (supabase) {
          try {
            const minimalUpdate: Record<string, any> = {
              project: finalResult.project,
              item: finalResult.item,
              componentName: finalResult.componentName,
              pileId: finalResult.pileId,
              reportNumber: finalResult.reportNumber,
              diameter: finalResult.diameter,
              constructionStart: finalResult.constructionStart,
              constructionEnd: finalResult.constructionEnd,
              notes: finalResult.notes,
              layers: finalResult.layers,
            };
            if (finalResult.excelUrl) minimalUpdate.excelUrl = finalResult.excelUrl;
            // Lưu fileUrl và fileName mới khi đã thay thế file trên GitHub
            if (finalResult.fileUrl) minimalUpdate.fileUrl = finalResult.fileUrl;
            if (finalResult.fileName) minimalUpdate.fileName = finalResult.fileName;
            // Lưu casingElevation (có thể null)
            minimalUpdate.casingElevation = finalResult.casingElevation ?? null;

            const { error } = await supabase
              .from('drill_extractions')
              .update(minimalUpdate)
              .eq('id', finalResult.id);

            if (error) {
              showToast(`⚠️ Lưu thất bại: ${error.message}`, 'error', 5000);
            } else {
              try {
                const savedHistory = localStorage.getItem('pile_drill_history');
                if (savedHistory) {
                  const arr = JSON.parse(savedHistory);
                  localStorage.setItem('pile_drill_history', JSON.stringify(
                    arr.map((r: any) => r.id === finalResult.id ? { ...r, ...minimalUpdate } : r)
                  ));
                }
              } catch {}
              showToast('✅ Đã đồng bộ dữ liệu thành công!', 'success', 3500);
            }
          } catch (e: any) {
            showToast(`⚠️ Lỗi kết nối: ${e?.message || 'Không xác định'}`, 'error', 5000);
          }
        } else {
          showToast('⚠️ Chưa kết nối Supabase — lưu tạm thời', 'error', 4000);
        }
      },
    });
  };

  // ── ChuanHoaDataView: Chuẩn hóa data (3 tab: Địa chất / Dự án / Đường kính) ──
    const GeologyView = () => {
      type DataTab = 'geology' | 'project' | 'diameter';
      const [activeTab, setActiveTab] = React.useState<DataTab>('geology');

      const [isAiNormalizing, setIsAiNormalizing] = React.useState(false);
      const [aiSuggestions, setAiSuggestions] = React.useState<{ standardName: string; originalNames: string[] }[] | null>(null);
      const [showAiModal, setShowAiModal] = React.useState(false);
      const [selectedGroups, setSelectedGroups] = React.useState<number[]>([]);

      const [isAiClassifying, setIsAiClassifying] = React.useState(false);
      const [aiClassificationPreview, setAiClassificationPreview] = React.useState<{ originalName: string; oldClass: string; newClass: string }[]>([]);
      const [showClassificationModal, setShowClassificationModal] = React.useState(false);
      const [searchQuery, setSearchQuery] = React.useState('');

      const updateAiSuggestionName = (idx: number, newName: string) => {
        if (!aiSuggestions) return;
        const next = [...aiSuggestions];
        next[idx].standardName = newName;
        setAiSuggestions(next);
      };

      const removeAiSuggestionGroup = (idx: number) => {
        if (!aiSuggestions) return;
        const next = aiSuggestions.filter((_, i) => i !== idx);
        setAiSuggestions(next);
        setSelectedGroups(prev => prev.filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
      };

      const [viewingReports, setViewingReports] = React.useState<{ value: string, reports: any[] } | null>(null);

      const showReportsForItem = (value: string) => {
        let reports: any[] = [];
        if (activeTab === 'geology') {
          reports = history.filter(res => 
            (res.layers || []).some(layer => (layer.layerDesign || '').trim() === value)
          );
        } else if (activeTab === 'project') {
          reports = history.filter(res => (res.project || '').trim() === value);
        } else if (activeTab === 'diameter') {
          reports = history.filter(res => (res.diameter || '').trim() === value);
        }
        setViewingReports({ value, reports });
      };

      const removeOriginalNameFromGroup = (groupIdx: number, nameIdx: number) => {
        if (!aiSuggestions) return;
        const next = [...aiSuggestions];
        const group = { ...next[groupIdx] };
        group.originalNames = group.originalNames.filter((_, i) => i !== nameIdx);
        
        if (group.originalNames.length === 0) {
          removeAiSuggestionGroup(groupIdx);
        } else {
          next[groupIdx] = group;
          setAiSuggestions(next);
        }
      };

    // ── Generic editable-list hook ──
    const useEditableList = <T extends { value: string; count: number }>(
      getItems: () => T[],
      getField: (layer: DrillLayer, res: ExtractionResult) => string,
      setField: (layer: DrillLayer, newVal: string) => DrillLayer,
      getResField?: (res: ExtractionResult) => string,
      setResField?: (res: ExtractionResult, newVal: string) => ExtractionResult
    ) => {
      const [editingKey, setEditingKey] = React.useState<string | null>(null);
      const [editValue, setEditValue] = React.useState('');
      const [savingKey, setSavingKey] = React.useState<string | null>(null);
      const [syncStatus, setSyncStatus] = React.useState<'idle'|'syncing'|'done'|'error'>('idle');
      const [syncCount, setSyncCount] = React.useState(0);

      const items = React.useMemo(() => {
        const allItems = getItems();
        if (!searchQuery.trim()) return allItems;
        const q = searchQuery.toLowerCase().trim();
        return allItems.filter(it => it.value.toLowerCase().includes(q));
      }, [history, searchQuery]);

      const startEdit = (key: string) => { setEditingKey(key); setEditValue(key); };
      const cancelEdit = () => { setEditingKey(null); setEditValue(''); };

      const commitEdit = async (oldVal: string, providedNewVal?: string) => {
        const newVal = stripLayerPrefix((providedNewVal || editValue).trim());
        if (!newVal || newVal === oldVal) { cancelEdit(); return; }

        type ToUpdate = { result: ExtractionResult; newLayers?: DrillLayer[]; newRes?: Partial<ExtractionResult> };
        const toUpdateList: ToUpdate[] = [];

        history.forEach(res => {
          // Nếu có setResField (cho project/diameter) → cập nhật cả header biên bản
          if (setResField && getResField) {
            const resVal = (getResField(res) || '').trim();
            if (resVal === oldVal) {
              const newRes = setResField(res, newVal);
              // Cập nhật layers cũng nếu có
              const newLayers = res.layers.map(l => {
                const layerVal = (getField(l, res) || '').trim();
                return layerVal === oldVal ? setField(l, newVal) : l;
              });
              toUpdateList.push({ result: res, newLayers, newRes });
              return;
            }
          }
          // Cập nhật trong layers
          const hasMatch = (res.layers || []).some(l => (getField(l, res) || '').trim() === oldVal);
          if (!hasMatch) return;
          const newLayers = res.layers.map(l =>
            (getField(l, res) || '').trim() === oldVal ? setField(l, newVal) : l
          );
          toUpdateList.push({ result: res, newLayers });
        });

        // Optimistic UI update
        setHistory(prev => prev.map(res => {
          const found = toUpdateList.find(u => u.result.id === res.id);
          if (!found) return res;
          return {
            ...res,
            ...(found.newRes || {}),
            ...(found.newLayers ? { layers: found.newLayers } : {}),
          };
        }));
        cancelEdit();

        setSavingKey(newVal);
        setSyncStatus('syncing');
        setSyncCount(toUpdateList.length);
        let errorCount = 0;
        try {
          if (supabase) {
            await Promise.all(toUpdateList.map(async ({ result, newLayers, newRes }) => {
              try {
                const updatePayload: any = {};
                if (newLayers) updatePayload.layers = newLayers;
                if (newRes) Object.assign(updatePayload, newRes);
                const { error } = await supabase.from('drill_extractions').update(updatePayload).eq('id', result.id);
                if (error) errorCount++;
              } catch { errorCount++; }
            }));
            // Sync localStorage
            try {
              const saved = localStorage.getItem('pile_drill_history');
              if (saved) {
                const arr = JSON.parse(saved);
                const updMap = new Map(toUpdateList.map(u => [u.result.id, u]));
                localStorage.setItem('pile_drill_history', JSON.stringify(
                  arr.map((r: any) => {
                    const found = updMap.get(r.id);
                    if (!found) return r;
                    return { ...r, ...(found.newRes || {}), ...(found.newLayers ? { layers: found.newLayers } : {}) };
                  })
                ));
              }
            } catch {}
            if (errorCount === 0) {
              setSyncStatus('done');
              showToast(`✅ Đã cập nhật "${newVal}" trong ${toUpdateList.length} biên bản!`, 'success', 3000);
            } else {
              setSyncStatus('error');
              showToast(`⚠️ Lỗi ${errorCount}/${toUpdateList.length} biên bản`, 'error', 4000);
            }
          } else {
            setSyncStatus('error');
            showToast('⚠️ Chưa kết nối Supabase', 'error', 3000);
          }
        } catch (e: any) {
          setSyncStatus('error');
          showToast(`⚠️ Lỗi: ${e?.message}`, 'error', 4000);
        } finally {
          setSavingKey(null);
          setTimeout(() => setSyncStatus('idle'), 3500);
        }
      };

      const bulkCommitEdit = async (mappings: { oldVal: string; newVal: string }[]) => {
        if (mappings.length === 0) return;
        
        type ToUpdate = { result: ExtractionResult; newLayers?: DrillLayer[]; newRes?: Partial<ExtractionResult> };
        const toUpdateMap = new Map<string, ToUpdate>();

        mappings.forEach(({ oldVal, newVal }) => {
          const targetNewVal = stripLayerPrefix(newVal.trim());
          history.forEach(res => {
            let currentUpdate = toUpdateMap.get(res.id);
            let currentLayers = currentUpdate?.newLayers || res.layers;
            let currentRes = currentUpdate?.newRes || {};

            let changed = false;
            
            if (setResField && getResField) {
              const resVal = (getResField(res) || '').trim();
              if (resVal === oldVal) {
                currentRes = setResField(res, targetNewVal);
                changed = true;
              }
            }

            const newLayers = currentLayers.map(l => {
              const layerVal = (getField(l, res) || '').trim();
              if (layerVal === oldVal) {
                changed = true;
                return setField(l, targetNewVal);
              }
              return l;
            });

            if (changed) {
              toUpdateMap.set(res.id, { result: res, newLayers, newRes: currentRes });
            }
          });
        });

        const toUpdateList = Array.from(toUpdateMap.values());
        if (toUpdateList.length === 0) return;

        // Optimistic UI update
        setHistory(prev => prev.map(res => {
          const found = toUpdateList.find(u => u.result.id === res.id);
          if (!found) return res;
          return {
            ...res,
            ...(found.newRes || {}),
            ...(found.newLayers ? { layers: found.newLayers } : {}),
          };
        }));

        setSyncStatus('syncing');
        setSyncCount(toUpdateList.length);
        let errorCount = 0;
        try {
          if (supabase) {
            await Promise.all(toUpdateList.map(async ({ result, newLayers, newRes }) => {
              try {
                const updatePayload: any = {};
                if (newLayers) updatePayload.layers = newLayers;
                if (newRes) Object.assign(updatePayload, newRes);
                const { error } = await supabase.from('drill_extractions').update(updatePayload).eq('id', result.id);
                if (error) errorCount++;
              } catch { errorCount++; }
            }));
            // Sync localStorage
            try {
              const saved = localStorage.getItem('pile_drill_history');
              if (saved) {
                const arr = JSON.parse(saved);
                const updMap = new Map(toUpdateList.map(u => [u.result.id, u]));
                localStorage.setItem('pile_drill_history', JSON.stringify(
                  arr.map((r: any) => {
                    const found = updMap.get(r.id);
                    if (!found) return r;
                    return { ...r, ...(found.newRes || {}), ...(found.newLayers ? { layers: found.newLayers } : {}) };
                  })
                ));
              }
            } catch {}
            if (errorCount === 0) {
              setSyncStatus('done');
              showToast(`✅ Đã chuẩn hóa ${mappings.length} nhóm trong ${toUpdateList.length} biên bản!`, 'success', 3000);
            } else {
              setSyncStatus('error');
              showToast(`⚠️ Lỗi ${errorCount}/${toUpdateList.length} biên bản`, 'error', 4000);
            }
          } else {
            setSyncStatus('error');
            showToast('⚠️ Chưa kết nối Supabase', 'error', 3000);
          }
        } catch (e: any) {
          setSyncStatus('error');
          showToast(`⚠️ Lỗi: ${e?.message}`, 'error', 4000);
        } finally {
          setTimeout(() => setSyncStatus('idle'), 3500);
        }
      };

      return { items, editingKey, editValue, setEditValue, savingKey, syncStatus, syncCount, startEdit, cancelEdit, commitEdit, bulkCommitEdit };
    };

    const handleAiNormalizeGeology = async () => {
      if (geoList.items.length === 0) return;
      setIsAiNormalizing(true);
      try {
        const apiKey = geminiApiKeys[activeKeyIndex] || userApiKey || (process.env.GEMINI_API_KEY as string);
        if (!apiKey) {
          showToast("Vui lòng cấu hình API Key trong phần Cài đặt.", "error");
          return;
        }
        
        const aiInstance = new GoogleGenAI({ apiKey });

        const groupedLayers = (geoList.items as any[]).reduce((acc, it) => {
          const sc = it.soilClass || 'Chưa Phân định nhóm';
          if (!acc[sc]) acc[sc] = [];
          acc[sc].push(it.value);
          return acc;
        }, {} as Record<string, string[]>);
        
        const prompt = `Bạn là một chuyên gia về địa chất công trình. 
Dưới đây là danh sách các mô tả lớp địa chất được trích xuất từ các biên bản khoan, được nhóm theo từng "Nhóm Đất hoặc Đá".

NHIỆM VỤ:
Trong TỪNG NHÓM, hãy tìm các mô tả tương đồng (thực chất là cùng một loại nhưng viết khác nhau) và đề xuất một "Tên chuẩn hóa" duy nhất cho mỗi nhóm nhỏ đó.

QUAN TRỌNG:
- CHỈ so sánh và gộp các tên TRONG CÙNG MỘT NHÓM. KHÔNG được gộp các tên từ hai nhóm khác nhau.
- Nếu một tên không có tên nào khác tương đồng trong cùng nhóm, hãy bỏ qua.

DANH SÁCH MÔ TẢ THEO NHÓM:
${JSON.stringify(groupedLayers, null, 2)}

YÊU CẦU ĐẦU RA (JSON thuần):
Trả về một mảng các đối tượng, mỗi đối tượng gồm:
- standardName: Tên chuẩn hóa bạn đề xuất (ngắn gọn, chính xác về thuật ngữ địa chất).
- originalNames: Mảng các tên gốc từ danh sách trên thuộc về nhóm này.

LƯU Ý:
- Chỉ nhóm những tên thực sự tương đồng. Nếu không chắc chắn, hãy để chúng riêng biệt.
- Không giải thích gì thêm, chỉ trả về JSON.`;

        const result = await aiInstance.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            responseMimeType: "application/json",
          }
        });

        const text = result.text;
        if (!text) throw new Error("AI không trả về kết quả.");
        const suggestions = JSON.parse(text);
        
        const filtered = suggestions.filter((s: any) => s.originalNames.length > 1);

        if (filtered.length === 0) {
          showToast("AI không tìm thấy nhóm nào cần chuẩn hóa thêm.", "success");
        } else {
          setAiSuggestions(filtered);
          setSelectedGroups(filtered.map((_: any, i: number) => i));
          setShowAiModal(true);
        }
      } catch (e: any) {
        console.error("AI Normalization error:", e);
        showToast(`Lỗi AI: ${e.message}`, "error");
      } finally {
        setIsAiNormalizing(false);
      }
    };

    const handleAiClassifySoilClasses = async () => {
      if (geoList.items.length === 0) return;
      setIsAiClassifying(true);
      try {
        const apiKey = geminiApiKeys[activeKeyIndex] || userApiKey || (process.env.GEMINI_API_KEY as string);
        if (!apiKey) {
          showToast("Vui lòng cấu hình API Key trong phần Cài đặt.", "error");
          return;
        }
        
        const aiInstance = new GoogleGenAI({ apiKey });

        const layerItems = geoList.items as any[];
        const layerNames = layerItems.map(it => it.value);
        
        const prompt = `Bạn là một chuyên gia về địa chất công trình Việt Nam. 
Dưới đây là danh sách các mô tả lớp địa chất. 
NHIỆM VỤ:
Hãy phân loại từng mô tả vào một trong các nhóm sau:
${SOIL_CLASSES.map(c => `- "${c}"`).join('\n')}

MÔ TẢ CÁC NHÓM:
- "Đất cấp I": Các loại đất rất mềm, bùn, đất lấp, cát rời...
- "Đất cấp II": Các loại đất sét, sét pha, cát chặt vừa...
- "Đất cấp III": Các loại đất sét cứng, cuội sỏi, cát rất chặt...
- "Đá cấp I": Các loại đá phong hóa, đá mềm, đá nứt nẻ...

DANH SÁCH MÔ TẢ:
${JSON.stringify(layerNames, null, 2)}

YÊU CẦU ĐẦU RA (JSON thuần):
Trả về một mảng các đối tượng, mỗi đối tượng gồm:
- originalName: Tên gốc từ danh sách trên.
- soilClass: Tên nhóm bạn phân loại (phải khớp chính xác với danh sách nhóm ở trên).

LƯU Ý:
- Nếu không chắc chắn, hãy gán "Chưa Phân định nhóm".
- Trả về JSON hợp lệ, không giải thích gì thêm.`;

        const result = await aiInstance.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            responseMimeType: "application/json",
          }
        });

        const text = result.text;
        if (!text) throw new Error("AI không trả về kết quả.");
        const classifications = JSON.parse(text);
        
        const preview = classifications.map((c: any) => {
          const item = layerItems.find(it => it.value === c.originalName);
          return {
            originalName: c.originalName,
            oldClass: item?.soilClass || 'Chưa Phân định nhóm',
            newClass: c.soilClass
          };
        }).filter((p: any) => p.oldClass !== p.newClass);

        if (preview.length === 0) {
          showToast("AI không tìm thấy thay đổi nào cần thiết.", "success");
        } else {
          setAiClassificationPreview(preview);
          setShowClassificationModal(true);
        }
      } catch (e: any) {
        console.error("AI Classification error:", e);
        showToast(`Lỗi AI: ${e.message}`, "error");
      } finally {
        setIsAiClassifying(false);
      }
    };

    const applyAiClassification = async () => {
      if (aiClassificationPreview.length === 0) return;
      
      try {
        const toUpdateMap = new Map<string, { result: ExtractionResult; newLayers: DrillLayer[] }>();
        
        aiClassificationPreview.forEach(p => {
          history.forEach(res => {
            const currentUpdate = toUpdateMap.get(res.id);
            const currentLayers = currentUpdate ? currentUpdate.newLayers : res.layers;
            
            const hasMatch = (currentLayers || []).some(l => (l.layerDesign || '').trim() === p.originalName);
            if (!hasMatch) return;

            const newLayers = currentLayers.map(l =>
              (l.layerDesign || '').trim() === p.originalName ? { ...l, soilClass: p.newClass } : l
            );
            toUpdateMap.set(res.id, { result: res, newLayers });
          });
        });

        const toUpdateList = Array.from(toUpdateMap.values());
        if (toUpdateList.length === 0) return;

        await Promise.all(toUpdateList.map(item =>
          supabase.from('drill_extractions').update({ layers: item.newLayers }).eq('id', item.result.id)
        ));
        
        const newHistory = history.map(res => {
          const match = toUpdateMap.get(res.id);
          return match ? { ...res, layers: match.newLayers } : res;
        });
        setHistory(newHistory);
        setShowClassificationModal(false);
        showToast(`Đã tự động phân định ${aiClassificationPreview.length} lớp địa chất`, 'success');
      } catch (e: any) {
        showToast(`Lỗi khi lưu phân định: ${e.message}`, 'error');
      }
    };

    const applyAiSuggestions = async () => {
      if (!aiSuggestions) return;
      const mappings: { oldVal: string; newVal: string }[] = [];
      
      aiSuggestions.forEach((group, idx) => {
        if (selectedGroups.includes(idx)) {
          group.originalNames.forEach(oldName => {
            if (oldName !== group.standardName) {
              mappings.push({ oldVal: oldName, newVal: group.standardName });
            }
          });
        }
      });

      if (mappings.length === 0) {
        setShowAiModal(false);
        return;
      }

      setShowAiModal(false);
      await geoList.bulkCommitEdit(mappings);
      setAiSuggestions(null);
    };

    // ── Tab 1: Cấu tạo lớp địa chất ──
    const geoList = useEditableList(
      () => {
        const map = new Map<string, { value: string; count: number; soilClass: string }>();
        history.forEach(res => {
          (res.layers || []).forEach(layer => {
            const v = (layer.layerDesign || '').trim();
            if (!v) return;
            const scRaw = (layer.soilClass || '').trim();
            // Nếu soilClass không nằm trong danh sách chuẩn → coi là "Chưa Phân định nhóm"
            const sc = SOIL_CLASSES.includes(scRaw) ? scRaw : 'Chưa Phân định nhóm';
            if (map.has(v)) {
              map.get(v)!.count++;
            } else {
              map.set(v, { value: v, count: 1, soilClass: sc });
            }
          });
        });
        return Array.from(map.values()).sort((a, b) => a.value.localeCompare(b.value, 'vi', { sensitivity: 'base' }));
      },
      (layer) => layer.layerDesign || '',
      (layer, newVal) => ({ ...layer, layerDesign: newVal, actualGeology: newVal })
    );

    const moveSoilClass = async (layerName: string, newClass: string) => {
      const toUpdateList: { result: ExtractionResult; newLayers: DrillLayer[] }[] = [];
      history.forEach(res => {
        const hasMatch = (res.layers || []).some(l => (l.layerDesign || '').trim() === layerName);
        if (!hasMatch) return;
        const newLayers = res.layers.map(l =>
          (l.layerDesign || '').trim() === layerName ? { ...l, soilClass: newClass } : l
        );
        toUpdateList.push({ result: res, newLayers });
      });

      if (toUpdateList.length === 0) return;

      try {
        await Promise.all(toUpdateList.map(item =>
          supabase.from('drill_extractions').update({ layers: item.newLayers }).eq('id', item.result.id)
        ));
        const newHistory = history.map(res => {
          const match = toUpdateList.find(u => u.result.id === res.id);
          return match ? { ...res, layers: match.newLayers } : res;
        });
        setHistory(newHistory);
        showToast(`Đã chuyển "${layerName}" sang nhóm ${newClass}`, 'success');
      } catch (e: any) {
        showToast(`Lỗi khi chuyển nhóm: ${e.message}`, 'error');
      }
    };

    // ── Tab 2: Dự án ──
    const projectList = useEditableList(
      () => {
        const map = new Map<string, { value: string; count: number; soilClass?: string }>();
        history.forEach(res => {
          const v = (res.project || '').trim();
          if (!v) return;
          map.has(v) ? map.get(v)!.count++ : map.set(v, { value: v, count: 1 });
        });
        return Array.from(map.values()).sort((a, b) => a.value.localeCompare(b.value, 'vi', { sensitivity: 'base' }));
      },
      (_layer, res) => res.project || '',
      (layer) => layer,
      (res) => res.project || '',
      (res, newVal) => ({ ...res, project: newVal })
    ) as any;

    // ── Tab 3: Đường kính ──
    const diameterList = useEditableList(
      () => {
        const map = new Map<string, { value: string; count: number; soilClass?: string }>();
        history.forEach(res => {
          const v = (res.diameter || '').trim();
          if (!v) return;
          map.has(v) ? map.get(v)!.count++ : map.set(v, { value: v, count: 1 });
        });
        return Array.from(map.values()).sort((a, b) => {
          const na = parseInt(a.value.replace(/\D/g, '')) || 0;
          const nb = parseInt(b.value.replace(/\D/g, '')) || 0;
          return na - nb;
        });
      },
      (_layer, res) => res.diameter || '',
      (layer) => layer,
      (res) => res.diameter || '',
      (res, newVal) => ({ ...res, diameter: newVal })
    ) as any;

    const tabs: { id: DataTab; label: string; icon: React.ReactNode; list: typeof geoList; emptyMsg: string; colHeader: string; activeClass: string; badgeClass: string; headerBg: string }[] = [
      {
        id: 'geology',
        label: 'Cấu tạo lớp địa chất',
        icon: <Layers size={14} />,
        list: geoList,
        emptyMsg: 'Chưa có dữ liệu lớp địa chất',
        colHeader: 'Mô tả lớp thiết kế',
        activeClass: 'bg-white text-emerald-700 shadow-md border-b-2 border-emerald-500',
        badgeClass: 'bg-emerald-100 text-emerald-700',
        headerBg: '#065f46',
      },
      {
        id: 'project',
        label: 'Dự án',
        icon: <Building2 size={14} />,
        list: projectList,
        emptyMsg: 'Chưa có dữ liệu dự án',
        colHeader: 'Tên dự án',
        activeClass: 'bg-white text-blue-700 shadow-md border-b-2 border-blue-500',
        badgeClass: 'bg-blue-100 text-blue-700',
        headerBg: '#1e3a8a',
      },
      {
        id: 'diameter',
        label: 'Đường kính',
        icon: <CircleDot size={14} />,
        list: diameterList,
        emptyMsg: 'Chưa có dữ liệu đường kính',
        colHeader: 'Đường kính cọc',
        activeClass: 'bg-white text-violet-700 shadow-md border-b-2 border-violet-500',
        badgeClass: 'bg-violet-100 text-violet-700',
        headerBg: '#4c1d95',
      },
    ];

    const activeTabData = tabs.find(t => t.id === activeTab)!;
    const { list, emptyMsg, colHeader } = activeTabData;
    const { items, editingKey, editValue, setEditValue, savingKey, syncStatus, syncCount, startEdit, cancelEdit, commitEdit } = list;

    const ROWS_PER_COL = 15;
    const cols: typeof items[] = [];
    for (let i = 0; i < items.length; i += ROWS_PER_COL) {
      cols.push(items.slice(i, i + ROWS_PER_COL));
    }

    return (
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <Sparkles size={24} className="text-orange-500" /> Chuẩn hóa data
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Chỉnh sửa tên sẽ <strong>đồng bộ toàn bộ biên bản</strong> liên quan
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'geology' && items.length > 0 && (
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAiClassifySoilClasses}
                    disabled={isAiClassifying || isAiNormalizing}
                    className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[11px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl shadow-lg shadow-blue-200 transition-all disabled:opacity-50"
                  >
                    {isAiClassifying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Phân định nhóm bằng AI
                  </button>
                  <button
                    onClick={handleAiNormalizeGeology}
                    disabled={isAiNormalizing || isAiClassifying}
                    className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-[11px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl shadow-lg shadow-orange-200 transition-all disabled:opacity-50"
                  >
                    {isAiNormalizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Chuẩn hóa bằng AI
                  </button>
                </div>
                <p className="text-[10px] text-red-500 font-bold italic">
                  * Lưu ý: Công cụ chuẩn hóa này chỉ so sánh các dữ liệu cùng Nhóm Đất hoặc đá
                </p>
              </div>
            )}
            {syncStatus === 'syncing' && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-200 animate-pulse">
                <Loader2 size={12} className="animate-spin" /> Đang đồng bộ {syncCount} biên bản...
              </span>
            )}
            {syncStatus === 'done' && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
                <CheckCircle2 size={12} /> Đã đồng bộ xong
              </span>
            )}
            {syncStatus === 'error' && (
              <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
                <AlertCircle size={12} /> Lỗi đồng bộ
              </span>
            )}
          </div>
        </div>

        {/* 3 Tab buttons */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSearchQuery('');
                }}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all',
                  activeTab === tab.id
                    ? tab.activeClass
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {tab.icon}
                {tab.label}
                <span className={cn(
                  'text-[10px] font-black px-2 py-0.5 rounded-full',
                  activeTab === tab.id ? tab.badgeClass : 'bg-slate-200 text-slate-500'
                )}>
                  {tab.list.items.length}
                </span>
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder={`Tìm kiếm ${activeTabData.label.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Tab description */}
        <div className="text-xs text-slate-400 font-medium -mt-3">
          {activeTab === 'geology' && 'Danh sách không trùng lặp các lớp địa chất — chỉnh sửa sẽ cập nhật layerDesign trong tất cả biên bản'}
          {activeTab === 'project' && 'Danh sách dự án — chỉnh sửa sẽ cập nhật trường "project" trong tất cả biên bản liên quan'}
          {activeTab === 'diameter' && 'Danh sách đường kính cọc — chỉnh sửa sẽ cập nhật trường "diameter" trong tất cả biên bản liên quan'}
        </div>

        {/* Table / Columns */}
        {items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-16 text-center">
            <Layers size={48} className="text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">{emptyMsg}</p>
            <p className="text-sm text-slate-400 mt-1">Hãy upload biên bản để xem dữ liệu</p>
          </div>
        ) : activeTab === 'geology' ? (
          <DragDropContext onDragEnd={(result: DropResult) => {
            if (!result.destination) return;
            const itemValue = result.draggableId;
            const newClass = result.destination.droppableId;
            const oldClass = result.source.droppableId;
            if (newClass !== oldClass) {
              moveSoilClass(itemValue, newClass);
            }
          }}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {SOIL_CLASSES.map((sc, scIdx) => {
                const classItems = (geoList.items as any[]).filter(it => it.soilClass === sc);
                const headerColors = [
                  { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', badge: 'bg-slate-200 text-slate-600' },
                  { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-600' },
                  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-600' },
                  { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-600' },
                  { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-600' },
                ][scIdx] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-100', badge: 'bg-slate-100 text-slate-500' };
                return (
                  <Droppable key={sc} droppableId={sc}>
                    {(provided, snapshot) => (
                      <div 
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          "flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden min-h-[400px] transition-colors",
                          snapshot.isDraggingOver ? "bg-blue-50/50 border-blue-300" : ""
                        )}
                      >
                        <div className={cn("px-4 py-3 border-b flex items-center justify-between", headerColors.bg, headerColors.border)}>
                          <h4 className={cn("text-[11px] font-black uppercase tracking-wider", headerColors.text)}>{sc}</h4>
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", headerColors.badge)}>
                            {classItems.length}
                          </span>
                        </div>
                        <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[600px] bg-white">
                          {classItems.map((row, idx) => {
                            const isEditing = editingKey === row.value;
                            const isSaving = savingKey === row.value;
                            return (
                              <Draggable key={row.value} draggableId={row.value} index={idx}>
                                {(provided, snapshot) => (
                                  <div 
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={cn(
                                      "bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-all group",
                                      snapshot.isDragging ? "shadow-xl border-blue-400 ring-2 ring-blue-400/20" : ""
                                    )}
                                  >
                                    {isEditing ? (
                                      <div className="space-y-2">
                                        <textarea
                                          autoFocus
                                          className="w-full border-2 border-blue-400 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                                          rows={2}
                                          value={editValue}
                                          onChange={e => setEditValue(e.target.value)}
                                        />
                                        <div className="flex gap-1">
                                          <button onClick={() => commitEdit(row.value)} className="flex-1 bg-green-500 text-white text-[10px] py-1 rounded-lg font-bold">Lưu</button>
                                          <button onClick={cancelEdit} className="flex-1 bg-slate-100 text-slate-600 text-[10px] py-1 rounded-lg font-bold">Hủy</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div 
                                        className="space-y-2 cursor-pointer group/card"
                                        onClick={() => showReportsForItem(row.value)}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <span className="text-xs text-slate-700 font-medium leading-tight group-hover/card:text-blue-600 transition-colors">{row.value}</span>
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); startEdit(row.value); }} 
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 rounded-lg transition-all"
                                          >
                                            <Edit2 size={12} className="text-blue-500" />
                                          </button>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <div className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100 group-hover/card:bg-blue-100 transition-colors">
                                            {row.count} biên bản
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                      </div>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </DragDropContext>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex gap-0 divide-x divide-slate-200">
              {cols.map((colRows, colIdx) => (
                <div key={colIdx} className="flex-1 min-w-0">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr style={{ background: activeTabData.headerBg }}>
                        <th className="px-3 py-3 text-xs font-bold text-white text-center w-10 border-r border-white/20">#</th>
                        <th className="px-3 py-3 text-xs font-bold text-white text-left border-r border-white/20">{colHeader}</th>
                        <th className="px-3 py-3 text-xs font-bold text-white text-center w-20 whitespace-nowrap">Số biên bản</th>
                      </tr>
                    </thead>
                    <tbody>
                      {colRows.map((row, rowIdx) => {
                        const globalIdx = colIdx * ROWS_PER_COL + rowIdx;
                        const isEditing = editingKey === row.value;
                        const isSaving = savingKey === row.value;
                        const rowBg = globalIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
                        return (
                          <tr key={row.value} style={{ background: rowBg }} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                            <td className="px-3 py-2.5 text-xs text-center text-slate-400 font-mono">{globalIdx + 1}</td>
                            <td className="px-3 py-2.5">
                              {isEditing ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    autoFocus
                                    className="flex-1 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitEdit(row.value);
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                  />
                                  <button onClick={() => commitEdit(row.value)}
                                    className="flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded-lg font-semibold transition-colors whitespace-nowrap">
                                    <CheckCircle2 size={11} /> Lưu
                                  </button>
                                  <button onClick={cancelEdit}
                                    className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-lg font-semibold transition-colors">
                                    <X size={11} /> Hủy
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between group">
                                  <div 
                                    className="flex items-center gap-1.5 cursor-pointer flex-1" 
                                    onClick={() => showReportsForItem(row.value)}
                                  >
                                    {isSaving ? (
                                      <span className="flex items-center gap-1.5 text-blue-600 text-xs">
                                        <Loader2 size={12} className="animate-spin" /> Đang lưu...
                                      </span>
                                    ) : (
                                      <span className="text-xs text-slate-700 leading-snug group-hover:text-blue-600 transition-colors">{row.value}</span>
                                    )}
                                  </div>
                                  {!isSaving && (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); startEdit(row.value); }}
                                      className="p-1 hover:bg-slate-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                      <Edit2 size={11} className="text-blue-400" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button 
                                onClick={() => showReportsForItem(row.value)}
                                className="inline-flex items-center justify-center bg-blue-50 text-blue-700 font-bold text-xs px-2 py-0.5 rounded-full border border-blue-200 hover:bg-blue-100 transition-colors"
                              >
                                {row.count}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Normalization Modal */}
        {showAiModal && aiSuggestions && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-orange-500 to-amber-500 text-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight">Gợi ý chuẩn hóa bằng AI</h3>
                    <p className="text-xs text-orange-100 font-medium">AI đã tìm thấy {aiSuggestions.length} nhóm tên tương đồng</p>
                  </div>
                </div>
                <button onClick={() => setShowAiModal(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
                {aiSuggestions.map((group, idx) => (
                  <div 
                    key={idx} 
                    className={cn(
                      "p-5 rounded-2xl border-2 transition-all group relative",
                      selectedGroups.includes(idx) 
                        ? "bg-white border-orange-400 shadow-md" 
                        : "bg-slate-100 border-transparent opacity-60"
                    )}
                  >
                    <div className="flex gap-6">
                      {/* Left: Original Names */}
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full uppercase tracking-wider">Các tên gốc sẽ gộp</span>
                          <div className="h-px flex-1 bg-slate-200" />
                        </div>
                        <div className="space-y-1.5 pl-4 border-l-2 border-slate-200">
                          {group.originalNames.map((name, nIdx) => (
                            <div key={nIdx} className="text-xs text-slate-600 flex items-center justify-between group/item hover:bg-slate-100 p-1 rounded-lg transition-colors">
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                                {name}
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeOriginalNameFromGroup(idx, nIdx);
                                }}
                                className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-red-100 hover:text-red-500 text-slate-400 rounded transition-all"
                                title="Loại bỏ tên này khỏi nhóm"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Middle: Arrow */}
                      <div className="flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-500">
                          <ArrowRight size={20} />
                        </div>
                      </div>

                      {/* Right: Edit Name */}
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Tên sửa đổi lại</span>
                          <div className="h-px flex-1 bg-orange-100" />
                        </div>
                        <div className="relative">
                          <textarea
                            rows={3}
                            value={group.standardName}
                            onChange={(e) => updateAiSuggestionName(idx, e.target.value)}
                            className="w-full bg-white border-2 border-orange-200 focus:border-orange-500 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 outline-none transition-all pr-10 resize-none leading-relaxed"
                            placeholder="Nhập tên chuẩn hóa..."
                          />
                          <div className="absolute right-3 top-4 text-orange-400">
                            <CheckCircle2 size={16} />
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2 justify-center">
                        <button 
                          onClick={() => {
                            setSelectedGroups(prev => 
                              prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
                            );
                          }}
                          className={cn(
                            "w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all shadow-sm",
                            selectedGroups.includes(idx) ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-slate-300 text-slate-400 hover:border-orange-300 hover:text-orange-400"
                          )}
                        >
                          <CheckCircle2 size={20} />
                        </button>
                        <button 
                          onClick={() => removeAiSuggestionGroup(idx)}
                          className="w-10 h-10 rounded-xl bg-white border-2 border-slate-200 text-slate-400 hover:border-red-300 hover:text-red-500 transition-all shadow-sm flex items-center justify-center"
                          title="Xóa nhóm này"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t border-slate-100 bg-white flex items-center justify-between">
                <button 
                  onClick={() => setSelectedGroups(selectedGroups.length === aiSuggestions.length ? [] : aiSuggestions.map((_, i) => i))}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors uppercase tracking-widest"
                >
                  {selectedGroups.length === aiSuggestions.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setShowAiModal(false)}
                    className="px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-all uppercase tracking-widest"
                  >
                    Hủy bỏ
                  </button>
                  <button 
                    onClick={applyAiSuggestions}
                    disabled={selectedGroups.length === 0}
                    className="px-10 py-3 rounded-xl text-sm font-black uppercase tracking-widest bg-orange-500 hover:bg-orange-600 text-white shadow-xl shadow-orange-200 transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                  >
                    Áp dụng chuẩn hóa ({selectedGroups.length})
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Classification Modal */}
        {showClassificationModal && aiClassificationPreview.length > 0 && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight">Phân định nhóm bằng AI</h3>
                    <p className="text-xs text-blue-100 font-medium">AI đề xuất thay đổi phân loại cho {aiClassificationPreview.length} lớp địa chất</p>
                  </div>
                </div>
                <button onClick={() => setShowClassificationModal(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-2 bg-slate-50">
                <div className="grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200">
                  <div className="col-span-5">Lớp địa chất</div>
                  <div className="col-span-3 text-center">Nhóm cũ</div>
                  <div className="col-span-3 text-center">Nhóm mới (AI đề xuất)</div>
                  <div className="col-span-1 text-right">Xóa</div>
                </div>
                {aiClassificationPreview.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-4 items-center p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-blue-300 transition-all group">
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs">
                        {idx + 1}
                      </div>
                      <span className="text-xs font-bold text-slate-700 leading-tight">{item.originalName}</span>
                    </div>
                    <div className="col-span-3 text-center">
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
                        {item.oldClass}
                      </span>
                    </div>
                    <div className="col-span-3 flex items-center justify-center gap-2">
                      <ArrowRight size={14} className="text-slate-300" />
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-200">
                        {item.newClass}
                      </span>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button 
                        onClick={() => setAiClassificationPreview(prev => prev.filter((_, i) => i !== idx))}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="Xóa đề xuất này"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t border-slate-100 bg-white flex items-center justify-end gap-4">
                <button 
                  onClick={() => setShowClassificationModal(false)}
                  className="px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-all uppercase tracking-widest"
                >
                  Hủy bỏ
                </button>
                <button 
                  onClick={applyAiClassification}
                  className="px-10 py-3 rounded-xl text-sm font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-200 transition-all flex items-center gap-2"
                >
                  Lưu thay đổi ({aiClassificationPreview.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Viewing Reports Modal */}
        {viewingReports && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                    <FileText size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight text-slate-800">Danh sách biên bản</h3>
                    <p className="text-xs text-slate-400 font-medium">Có {viewingReports.reports.length} biên bản chứa giá trị: <span className="text-blue-600 font-bold">"{viewingReports.value}"</span></p>
                  </div>
                </div>
                <button onClick={() => setViewingReports(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {viewingReports.reports.map((report, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-300 transition-all group">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-xs">
                            {idx + 1}
                          </div>
                          <div>
                            <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{report.boreholeId || "N/A"}</p>
                            <p className="text-[10px] text-slate-400 font-medium">{report.project || "Dự án không xác định"}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                          {report.diameter || "N/A"} mm
                        </span>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400">Độ sâu:</span>
                          <span className="font-bold text-slate-700">{report.depth || 0}m</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-400">Số lớp:</span>
                          <span className="font-bold text-slate-700">{(report.layers || []).length}</span>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-50 flex justify-end">
                        <button 
                          onClick={() => {
                            setViewingReports(null);
                            setActiveSheet('upload');
                            handleEdit(report);
                          }}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          Xem chi tiết <ArrowRight size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-white flex justify-end">
                <button 
                  onClick={() => setViewingReports(null)}
                  className="px-8 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-all uppercase tracking-widest"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

    return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans overflow-x-hidden">

      {/* ── Splash Screen Loading — hiển thị khi F5, dùng logo của người dùng ── */}
      {isInitialLoading && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{ background: "linear-gradient(160deg, #1a3a6b 0%, #1e4480 50%, #163570 100%)" }}
        >
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center gap-5">
            <div className="w-28 h-28 rounded-3xl overflow-hidden shadow-2xl border-4 border-white/20 flex items-center justify-center bg-white/10">
              {customLogo ? (
                <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16">
                  <rect x="8" y="28" width="10" height="28" rx="2" fill="white" fillOpacity="0.9"/>
                  <rect x="27" y="16" width="10" height="40" rx="2" fill="white"/>
                  <rect x="46" y="8" width="10" height="48" rx="2" fill="white" fillOpacity="0.7"/>
                </svg>
              )}
            </div>
            <div className="text-center">
              <p className="text-white font-black text-3xl tracking-widest uppercase">SGC – CKN</p>
              <p className="text-blue-300 text-xs font-bold tracking-[0.3em] uppercase mt-1">Construction Management</p>
            </div>
          </div>

          {/* Thanh loading */}
          <div className="w-56 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-400 rounded-full"
              style={{
                animation: 'splash-bar 1.6s ease-in-out infinite',
              }}
            />
          </div>
          <p className="text-blue-300/60 text-xs mt-4 tracking-widest uppercase">Đang tải dữ liệu...</p>

          <style>{`
            @keyframes splash-bar {
              0%   { width: 0%;   margin-left: 0%; }
              50%  { width: 70%;  margin-left: 15%; }
              100% { width: 0%;   margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {/* ── Toast thông báo đồng bộ ── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-white font-bold text-sm transition-all animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-600' :
          toast.type === 'error'   ? 'bg-red-600' :
          'bg-[#1a3a6b]'
        }`}>
          {toast.type === 'loading' && (
            <svg className="animate-spin w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ── Confirm Dialog (thay window.confirm) ── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[9997] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className={`px-7 py-5 flex items-center gap-3 ${confirmDialog.type === 'delete' ? 'bg-red-600' : 'bg-[#1a3a6b]'}`}>
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                {confirmDialog.type === 'delete'
                  ? <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  : <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                }
              </div>
              <h2 className="text-white font-black text-lg tracking-tight">{confirmDialog.title}</h2>
            </div>

            {/* Body */}
            <div className="px-7 py-6">
              <p className="text-slate-800 font-semibold text-base mb-2">{confirmDialog.message}</p>
              {confirmDialog.detail && (
                <div className={`mt-3 p-3 rounded-xl text-xs font-medium whitespace-pre-line ${confirmDialog.type === 'delete' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                  {confirmDialog.detail}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="px-7 pb-6 flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
              >
                Hủy bỏ
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 py-3 rounded-xl text-white font-black transition-all active:scale-95 shadow-lg ${
                  confirmDialog.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                    : 'bg-[#1a3a6b] hover:bg-[#1e4480] shadow-blue-200'
                }`}
              >
                {confirmDialog.type === 'delete' ? 'Xác nhận xóa' : 'Đồng ý lưu'}
              </button>
            </div>
          </div>
        </div>
      )}


      <div 
        className={cn(
          "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity duration-300",
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar Menu */}
      <aside 
        ref={sidebarRef}
        className={cn(
          "fixed top-0 left-0 h-full w-72 z-50 shadow-2xl transition-transform duration-500 ease-out transform border-r border-[#1e3a5f]",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ background: "linear-gradient(160deg, #1a3a6b 0%, #1e4480 50%, #163570 100%)" }}
        onMouseLeave={() => setIsSidebarOpen(false)}
      >
        <div className="p-8 h-full flex flex-col">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center shadow-sm border border-[#1e4070]">
                {customLogo ? (
                  <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                    <Construction className="text-white w-8 h-8" />
                  </div>
                )}
              </div>
              <div>
                <span className="font-bold text-white uppercase tracking-tight block text-lg">SGC - CKN</span>
                <span className="text-[10px] font-bold text-blue-300 uppercase tracking-[0.2em]">Hệ thống quản lý</span>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-blue-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="space-y-1 flex-1">
            <p className="text-[13px] font-black text-white uppercase tracking-widest mb-4 px-4">Danh mục chính</p>
            <button 
              onClick={() => { setActiveSheet('upload'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'upload' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-900/40" 
                  : "hover:bg-white/10 text-blue-200"
              )}
            >
              <Upload size={18} className={activeSheet === 'upload' ? "text-white" : "text-blue-300 group-hover:text-white"} />
              <span className="font-medium text-sm">Dữ liệu Biên bản</span>
            </button>

            <button 
              onClick={() => { setActiveSheet('summary'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'summary' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-900/40" 
                  : "hover:bg-white/10 text-blue-200"
              )}
            >
              <Database size={18} className={activeSheet === 'summary' ? "text-white" : "text-blue-300 group-hover:text-white"} />
              <span className="font-medium text-sm">Dashboard tổng hợp</span>
            </button>

            <button 
              onClick={() => { setActiveSheet('geology'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'geology' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-900/40" 
                  : "hover:bg-white/10 text-blue-200"
              )}
            >
              <Layers size={18} className={activeSheet === 'geology' ? "text-white" : "text-blue-300 group-hover:text-white"} />
              <span className="font-medium text-sm">Chuẩn hóa data</span>
            </button>

            <button 
              onClick={() => { setActiveSheet('pdf-splitter'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'pdf-splitter' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-900/40" 
                  : "hover:bg-white/10 text-blue-200"
              )}
            >
              <Scissors size={18} className={activeSheet === 'pdf-splitter' ? "text-white" : "text-blue-300 group-hover:text-white"} />
              <span className="font-medium text-sm">Tách file PDF</span>
            </button>
          </nav>

          <div className="pt-6 border-t border-[#1e3a5f]">
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.05)" }}>
              <p className="text-[10px] font-bold text-blue-300/70 uppercase tracking-widest mb-1">Phiên bản hiện tại</p>
              <p className="text-xs font-medium text-blue-100">v2.1.0 Professional</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="border-b border-[#1e3a5f] px-5 py-1 flex items-center justify-between sticky top-0 z-30 text-white min-h-[64px]" style={{ background: "#1a3a6b" }}>
        <div 
          className="flex items-center gap-3 cursor-pointer group"
          onMouseEnter={() => setIsSidebarOpen(true)}
          onClick={() => setIsSidebarOpen(true)}
        >
          <div className="w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center shadow-md group-hover:scale-105 transition-transform border border-blue-700 bg-white">
            {customLogo ? (
              <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                <Construction className="text-white w-6 h-6" />
              </div>
            )}
          </div>
          <div>
            <h1 className="text-[18px] font-black text-white uppercase tracking-tight leading-none">SGC - CKN</h1>
            <p className="text-[9px] font-bold text-blue-300 uppercase tracking-[0.2em] mt-0.5">
              Construction Management
            </p>
          </div>
          <div className="ml-1 p-1.5 bg-white/10 rounded-lg text-blue-300 group-hover:text-white transition-colors">
            <Menu size={16} />
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 bg-white/10 border border-white/10 text-white rounded-xl hover:bg-white/20 transition-all shadow-sm"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf" multiple onChange={handleFileUpload} />

      {/* ── BANNER CẢNH BÁO: Tất cả API Key hết quota ── */}
      {geminiApiKeys.some(k => k.trim()) && geminiApiKeys.every((k, i) => !k.trim() || exhaustedKeys.has(i)) && (
        <div className="bg-red-600 text-white px-6 py-3 flex items-center gap-3 sticky top-[64px] z-20 shadow-lg">
          <span className="text-xl shrink-0">⛔</span>
          <div className="flex-1">
            <span className="font-black text-[13px] uppercase tracking-widest">Tất cả {geminiApiKeys.filter(k => k.trim()).length} API Key Gemini đã hết quota!</span>
            <span className="text-red-200 text-[12px] ml-2">Vui lòng thêm key mới hoặc chờ quota reset (thường sau 24h).</span>
          </div>
          <button
            onClick={() => { setIsSettingsOpen(true); }}
            className="px-4 py-1.5 bg-white text-red-600 rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-red-50 transition-colors shrink-0"
          >
            ⚙ Cài đặt Key
          </button>
          <button
            onClick={() => { setExhaustedKeys(new Set()); setActiveKeyIndex(0); }}
            className="px-4 py-1.5 bg-red-500 border border-red-300 text-white rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-red-400 transition-colors shrink-0"
          >
            ↺ Thử lại
          </button>
        </div>
      )}

      <main className="flex-1 p-8 w-full space-y-10">
        {activeSheet === 'upload' ? (
          <div className="w-full space-y-12">
            {/* === SPLIT-SCREEN KHI CÓ FILE ĐANG XỬ LÝ HOẶC CHỜ DUYỆT === */}
            {(processingFiles.length > 0 || pendingResults.length > 0) ? (
              <div className={cn(
                "flex gap-0 h-[calc(100vh-160px)] rounded-3xl overflow-hidden border border-slate-200 shadow-xl transition-all duration-500",
                !currentResult ? "justify-center bg-slate-50/50" : ""
              )}>

                {/* CỘT TRÁI: Danh sách file - thu gọn */}
                <div className={cn(
                  "flex flex-col transition-all duration-500",
                  currentResult ? "w-64 flex-shrink-0" : "w-full max-w-3xl shadow-2xl"
                )} style={{ background: "linear-gradient(160deg, #1a3a6b 0%, #1e4480 50%, #163570 100%)" }}>
                  <div className="px-6 py-5 border-b border-[#1e3a5f]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Loader2 className={cn("w-5 h-5 text-blue-400", isProcessing && "animate-spin")} />
                        <span className="text-[13px] font-black text-white uppercase tracking-widest">
                          Tiến trình ({processingFiles.filter(f => f.status !== 'completed').length})
                        </span>
                      </div>
                      {!currentResult && processingFiles.length > 0 && (
                        <span className="text-[10px] font-bold text-blue-300/60 uppercase tracking-widest">
                          Chờ kiểm tra và lưu
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
                    {/* Files đang xử lý */}
                    {processingFiles.map((file) => (
                      <div
                        key={file.id}
                        onClick={() => file.status === 'completed' && file.result && setCurrentResult(file.result)}
                        className={cn(
                          "p-4 rounded-2xl transition-all group relative border border-transparent",
                          file.status === 'completed' && file.result
                            ? currentResult?.id === file.result?.id
                              ? "bg-blue-600 border-blue-400/30 cursor-pointer shadow-lg"
                              : "bg-blue-900/60 hover:bg-blue-900/80 cursor-pointer"
                            : "bg-blue-900/30 cursor-default"
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                            file.status === 'completed' ? "bg-emerald-500/20 text-emerald-400" :
                            file.status === 'error' ? "bg-red-500/20 text-red-400" :
                            "bg-blue-800 text-blue-300"
                          )}>
                            {file.status === 'completed' ? <CheckCircle2 size={18} /> :
                             file.status === 'error' ? <AlertCircle size={18} /> :
                             file.status === 'processing' ? <Loader2 size={18} className="animate-spin" /> :
                             <FileText size={18} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-bold text-white truncate">{file.fileName}</p>
                              {file.status === 'completed' && !currentResult && (
                                <span className="text-[9px] font-black text-orange-400/80 uppercase tracking-tighter bg-orange-500/10 px-1.5 py-0.5 rounded">Chờ lưu</span>
                              )}
                            </div>
                            <p className={cn(
                              "text-[11px] font-medium mt-1",
                              file.status === 'completed' ? "text-emerald-400" :
                              file.status === 'error' ? "text-red-400" :
                              file.status === 'processing' ? "text-orange-400" : "text-blue-400"
                            )}>
                              {file.status === 'pending' ? 'Đang chờ...' :
                               file.status === 'processing' ? `Phân tích... ${file.progress}%` :
                               file.status === 'completed' ? 'Chờ lưu' : 'Lỗi xử lý'}
                            </p>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeProcessingFile(file.id); }}
                            className="opacity-0 group-hover:opacity-100 p-2 text-blue-400 hover:text-red-400 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {(file.status === 'processing' || file.status === 'pending') && (
                          <div className="mt-3 h-1.5 bg-blue-950 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all duration-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" style={{ width: `${file.progress}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Footer cột trái */}
                  <div className="p-6 border-t border-[#1e3a5f] bg-blue-950/20">
                    <div className="flex flex-col gap-4">
                      {pendingResults.length > 0 && (
                        <button
                          onClick={handleSaveAll}
                          disabled={isProcessing}
                          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[13px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-xl shadow-emerald-900/40 border border-emerald-400/30"
                        >
                          {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                          Lưu tất cả ({pendingResults.length})
                        </button>
                      )}
                      
                      <div className="flex gap-3">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40"
                        >
                          <Upload size={14} />
                          Thêm file
                        </button>
                        {processingFiles.every(f => f.status === 'completed' || f.status === 'error') && processingFiles.length > 0 && (
                          <button
                            onClick={() => {
                              if (pendingResults.length > 0) {
                                if (!window.confirm("Bạn có chắc chắn muốn hủy tất cả các file chưa lưu?")) return;
                              }
                              setProcessingFiles([]);
                              setPendingResults([]);
                              setCurrentResult(null);
                            }}
                            className="px-4 py-3 bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all"
                          >
                            Xóa hết
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* CỘT PHẢI: Chi tiết + chỉnh sửa */}
                {currentResult && (
                  <div className="flex-1 bg-white overflow-y-auto">
                    <div className="h-full flex flex-col">
                      {/* Header chi tiết */}
                      <div className="flex items-center justify-between bg-blue-600 px-8 py-5 flex-shrink-0">
                        <div className="flex items-center gap-4">
                          <div className="bg-white/10 p-2.5 rounded-xl">
                            <FileText size={20} className="text-white" />
                          </div>
                          <h3 className="text-base font-bold text-white uppercase tracking-tight">
                            {currentResult.fileName || currentResult.pileId}
                          </h3>
                        </div>
                        <button
                          onClick={() => setCurrentResult(null)}
                          className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/20 flex items-center gap-2"
                        >
                          <X size={14} />
                          Thoát
                        </button>
                      </div>

                      {/* Nội dung chi tiết = EditSplitView embedded */}
                      <div className="flex-1 overflow-hidden">
                        <EditSplitView
                          result={currentResult}
                          embedded={true}
                          onClose={() => setCurrentResult(null)}
                          githubCreds={githubCreds}
                          userApiKey={userApiKey}
                          onExtract={callExtractWithRotation}
                          onSave={(updated) => {
                            setCurrentResult(updated);
                            setPendingResults(prev => prev.map(r => r.id === updated.id ? updated : r));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Khi không có file nào đang xử lý */
              <div className="w-full space-y-12">

            {/* Main Data Table on Sheet 1 */}
            {!currentResult && (history.length > 0 ? (() => {
              // Parse date từ chuỗi "HH:mm DD/MM/YYYY"
              const parseDate = (s: string): Date | null => {
                const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (!m) return null;
                return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
              };
              const parseFilterDate = (s: string): Date | null => {
                if (!s) return null;
                const [y, mo, d] = s.split('-');
                return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
              };

              const filtered = history.map((item, idx) => ({ ...item, displayStt: history.length - idx }))
                .filter((item) => {
                const reportStt = item.displayStt.toString();
                if (filterStt && reportStt !== filterStt) return false;
                if (filterProject && !item.project?.toLowerCase().includes(filterProject.toLowerCase())) return false;
                if (filterItem && !item.item?.toLowerCase().includes(filterItem.toLowerCase())) return false;
                if (filterComponentName && !item.componentName?.toLowerCase().includes(filterComponentName.toLowerCase())) return false;
                if (filterPileId && !item.pileId?.toLowerCase().includes(filterPileId.toLowerCase())) return false;
                if (filterDiameter && !item.diameter?.toLowerCase().includes(filterDiameter.toLowerCase())) return false;
                if (filterDateFrom) {
                  const from = parseFilterDate(filterDateFrom);
                  const itemDate = parseDate(item.constructionEnd);
                  if (from && itemDate && itemDate < from) return false;
                }
                if (filterDateTo) {
                  const to = parseFilterDate(filterDateTo);
                  const itemDate = parseDate(item.constructionEnd);
                  if (to && itemDate && itemDate > to) return false;
                }
                return true;
              });

              const hasActiveFilter = filterProject || filterItem || filterComponentName || filterPileId || filterDiameter || filterDateFrom || filterDateTo || filterStt;

              const resetFilters = () => {
                setFilterProject(''); setFilterItem(''); setFilterComponentName('');
                setFilterPileId(''); setFilterDiameter('');
                setFilterDateFrom(''); setFilterDateTo('');
                setFilterStt('');
              };

              return (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[18px] font-black text-blue-900 tracking-tight flex items-center gap-3 uppercase">
                      <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
                      Dữ liệu thi công
                      {hasActiveFilter && (
                        <span className="text-[11px] font-black text-orange-500 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full normal-case">
                          {filtered.length}/{history.length} bản ghi
                        </span>
                      )}
                    </h3>
                    {isGithubConnected ? (
                      <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                        <Github size={12} fill="currentColor" />
                        <span className="text-[9px] font-bold uppercase tracking-widest">Đã kết nối GitHub</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-1 bg-sky-100 text-sky-400 rounded-full border border-sky-200">
                        <Github size={12} />
                        <span className="text-[9px] font-bold uppercase tracking-widest">Chưa kết nối GitHub</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-gradient-to-br from-orange-400 to-orange-600 text-white px-6 py-3 rounded-2xl text-[12px] font-black uppercase tracking-[0.1em] hover:from-orange-500 hover:to-orange-700 transition-all flex items-center gap-3 shadow-lg shadow-orange-500/30 border border-white/10 active:scale-95"
                    >
                      <Upload size={16} strokeWidth={2.5} />
                      Up File
                    </button>
                    {hasActiveFilter && (
                      <button
                        onClick={resetFilters}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-100 transition-all"
                      >
                        <RotateCw size={12} />
                        Xóa lọc
                      </button>
                    )}
                    <button
                      onClick={() => !isExportingAll && exportAllToExcel(filtered)}
                      disabled={isExportingAll}
                      className={cn(
                        "flex items-center gap-3 px-6 py-3 rounded-2xl text-[12px] font-black uppercase tracking-[0.1em] transition-all border border-white/10 text-white shadow-lg active:scale-95",
                        isExportingAll
                          ? "bg-slate-400 cursor-not-allowed shadow-slate-300/30"
                          : "bg-gradient-to-br from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 shadow-emerald-500/30"
                      )}
                      title={isExportingAll ? 'Đang tải ảnh và tạo Excel...' : `Xuất ${filtered.length} biên bản ra Excel`}
                    >
                      {isExportingAll ? (
                        <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>Đang xuất...</>
                      ) : (
                        <><ArrowDownToLine size={16} strokeWidth={2.5} />Xuất Excel</>
                      )}
                      {!isExportingAll && hasActiveFilter && (
                        <span className="bg-white/20 backdrop-blur-md text-white text-[10px] font-black px-2.5 py-0.5 rounded-full border border-white/20">
                          {filtered.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setShowFilters(p => !p)}
                      className={cn(
                        "flex items-center gap-3 px-6 py-3 rounded-2xl text-[12px] font-black uppercase tracking-[0.1em] transition-all border active:scale-95",
                        showFilters
                          ? "bg-gradient-to-br from-blue-500 to-blue-700 text-white border-white/10 shadow-lg shadow-blue-500/30"
                          : "bg-white text-blue-900 border-slate-200 hover:border-blue-400 shadow-md shadow-slate-200/50"
                      )}
                    >
                      <Filter size={16} strokeWidth={2.5} />
                      Bộ lọc
                      {hasActiveFilter && (
                        <span className="bg-orange-500 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full shadow-sm">
                          {[filterProject, filterItem, filterComponentName, filterPileId, filterDiameter, filterDateFrom, filterDateTo, filterStt].filter(Boolean).length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setActiveSheet('summary')}
                      className="group flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black text-blue-600 hover:bg-blue-50 uppercase tracking-widest transition-all active:scale-95"
                    >
                      <span>Dashboard</span>
                      <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                  <div className="rounded-2xl border border-slate-300/50 bg-[#f5f2e1] shadow-xl animate-in fade-in slide-in-from-top-2 duration-200" style={{ overflow: 'visible' }}>
                    <div className="px-6 py-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" style={{ overflow: 'visible' }}>
                      {/* STT */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">STT</label>
                        <div className="relative border border-slate-200 rounded-xl bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
                          <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <input value={filterStt} onChange={e => setFilterStt(e.target.value)} placeholder="Lọc theo STT..."
                            className="w-full pl-9 pr-9 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                          {filterStt && <button onClick={() => setFilterStt('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
                        </div>
                      </div>
                      {/* Dự án - Dropdown + Search */}
                      {(() => {
                        const opts = [...new Set(history.map(r => r.project).filter(Boolean))].sort();
                        const matched = opts.filter(p => p.toLowerCase().includes(filterProject.toLowerCase()));
                        return (
                          <div className="space-y-2 relative" ref={projectDropdownRef}>
                            <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">Dự án</label>
                            <div className={cn("relative border rounded-xl transition-all bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5", showProjectDropdown ? "border-blue-500 shadow-sm" : "border-slate-200")}>
                              <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              <input value={filterProject} onChange={e => { setFilterProject(e.target.value); setShowProjectDropdown(true); }} onFocus={() => setShowProjectDropdown(true)}
                                placeholder="Tìm kiếm dự án..."
                                className="w-full pl-9 pr-14 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                {filterProject && <button onClick={() => { setFilterProject(''); setShowProjectDropdown(false); }} className="p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
                                <div className="w-px h-3 bg-slate-200 mx-0.5" />
                                <button onClick={() => setShowProjectDropdown(p => !p)} className="p-1 text-slate-400 hover:text-blue-600 transition-colors"><ChevronDown size={14} className={cn("transition-transform duration-300", showProjectDropdown && "rotate-180")} /></button>
                              </div>
                            </div>
                            {showProjectDropdown && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[200]">
                                <button onClick={() => { setFilterProject(''); setShowProjectDropdown(false); }} className={cn("w-full text-left px-3 py-2 text-[12px] font-bold transition-colors flex items-center gap-2", !filterProject ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50")}>
                                  <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center shrink-0">{!filterProject && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block" />}</span>
                                  Tất cả ({opts.length} dự án)
                                </button>
                                <div className="border-t border-slate-100 max-h-52 overflow-y-auto custom-scrollbar">
                                  {matched.length === 0
                                    ? <p className="text-center py-4 text-[12px] text-slate-400">Không tìm thấy</p>
                                    : matched.map((p, i) => {
                                        const kw = filterProject.toLowerCase(); const idx = p.toLowerCase().indexOf(kw);
                                        return (
                                          <button key={i} onClick={() => { setFilterProject(p); setShowProjectDropdown(false); }}
                                            className={cn("w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2", filterProject === p ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50")}>
                                            <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center shrink-0">{filterProject === p && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block" />}</span>
                                            <span className="truncate flex-1">{p.slice(0,idx)}{idx>=0&&<span className="bg-yellow-200 text-yellow-900 font-black rounded px-0.5">{p.slice(idx,idx+filterProject.length)}</span>}{idx>=0?p.slice(idx+filterProject.length):''}</span>
                                            <span className="ml-auto text-[11px] font-black text-slate-400 shrink-0">{history.filter(r => r.project === p).length}</span>
                                          </button>
                                        );
                                      })
                                  }
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Hạng mục - Dropdown + Search */}
                      {(() => {
                        const opts = [...new Set(history.map(r => r.item).filter(Boolean))].sort();
                        const matched = opts.filter(p => p.toLowerCase().includes(filterItem.toLowerCase()));
                        return (
                          <div className="space-y-2 relative" ref={itemDropdownRef}>
                            <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">Hạng mục</label>
                            <div className={cn("relative border rounded-xl transition-all bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5", showItemDropdown ? "border-blue-500 shadow-sm" : "border-slate-200")}>
                              <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              <input value={filterItem} onChange={e => { setFilterItem(e.target.value); setShowItemDropdown(true); }} onFocus={() => setShowItemDropdown(true)}
                                placeholder="Tìm kiếm hạng mục..."
                                className="w-full pl-9 pr-14 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                {filterItem && <button onClick={() => { setFilterItem(''); setShowItemDropdown(false); }} className="p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
                                <div className="w-px h-3 bg-slate-200 mx-0.5" />
                                <button onClick={() => setShowItemDropdown(p => !p)} className="p-1 text-slate-400 hover:text-blue-600 transition-colors"><ChevronDown size={14} className={cn("transition-transform duration-300", showItemDropdown && "rotate-180")} /></button>
                              </div>
                            </div>
                            {showItemDropdown && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[200]">
                                <button onClick={() => { setFilterItem(''); setShowItemDropdown(false); }} className={cn("w-full text-left px-3 py-2 text-[12px] font-bold transition-colors flex items-center gap-2", !filterItem ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50")}>
                                  <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center shrink-0">{!filterItem && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block" />}</span>
                                  Tất cả ({opts.length} hạng mục)
                                </button>
                                <div className="border-t border-slate-100 max-h-52 overflow-y-auto custom-scrollbar">
                                  {matched.length === 0
                                    ? <p className="text-center py-4 text-[12px] text-slate-400">Không tìm thấy</p>
                                    : matched.map((p, i) => {
                                        const kw = filterItem.toLowerCase(); const idx = p.toLowerCase().indexOf(kw);
                                        return (
                                          <button key={i} onClick={() => { setFilterItem(p); setShowItemDropdown(false); }}
                                            className={cn("w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2", filterItem === p ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50")}>
                                            <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center shrink-0">{filterItem === p && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block" />}</span>
                                            <span className="truncate flex-1">{p.slice(0,idx)}{idx>=0&&<span className="bg-yellow-200 text-yellow-900 font-black rounded px-0.5">{p.slice(idx,idx+filterItem.length)}</span>}{idx>=0?p.slice(idx+filterItem.length):''}</span>
                                            <span className="ml-auto text-[11px] font-black text-slate-400 shrink-0">{history.filter(r => r.item === p).length}</span>
                                          </button>
                                        );
                                      })
                                  }
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Tên bộ phận */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">Tên bộ phận</label>
                        <div className="relative border border-slate-200 rounded-xl bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
                          <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <input value={filterComponentName} onChange={e => setFilterComponentName(e.target.value)} placeholder="Tìm kiếm tên bộ phận..."
                            className="w-full pl-9 pr-9 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                          {filterComponentName && <button onClick={() => setFilterComponentName('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
                        </div>
                      </div>
                      {/* Số hiệu cọc */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">Số hiệu cọc</label>
                        <div className="relative border border-slate-200 rounded-xl bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
                          <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <input value={filterPileId} onChange={e => setFilterPileId(e.target.value)} placeholder="Tìm kiếm số hiệu cọc..."
                            className="w-full pl-9 pr-9 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                          {filterPileId && <button onClick={() => setFilterPileId('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
                        </div>
                      </div>
                      {/* Đường kính - Dropdown + Search */}
                      {(() => {
                        const opts = [...new Set(history.map(r => r.diameter).filter(Boolean))].sort();
                        const matched = opts.filter(p => p.toLowerCase().includes(filterDiameter.toLowerCase()));
                        return (
                          <div className="space-y-2 relative" ref={diameterDropdownRef}>
                            <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">Đường kính</label>
                            <div className={cn("relative border rounded-xl transition-all bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5", showDiameterDropdown ? "border-blue-500 shadow-sm" : "border-slate-200")}>
                              <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              <input value={filterDiameter} onChange={e => { setFilterDiameter(e.target.value); setShowDiameterDropdown(true); }} onFocus={() => setShowDiameterDropdown(true)}
                                placeholder="Tìm kiếm đường kính..."
                                className="w-full pl-9 pr-14 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                                {filterDiameter && <button onClick={() => { setFilterDiameter(''); setShowDiameterDropdown(false); }} className="p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
                                <div className="w-px h-3 bg-slate-200 mx-0.5" />
                                <button onClick={() => setShowDiameterDropdown(p => !p)} className="p-1 text-slate-400 hover:text-blue-600 transition-colors"><ChevronDown size={14} className={cn("transition-transform duration-300", showDiameterDropdown && "rotate-180")} /></button>
                              </div>
                            </div>
                            {showDiameterDropdown && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[200]">
                                <button onClick={() => { setFilterDiameter(''); setShowDiameterDropdown(false); }} className={cn("w-full text-left px-3 py-2 text-[12px] font-bold transition-colors flex items-center gap-2", !filterDiameter ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50")}>
                                  <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center shrink-0">{!filterDiameter && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block" />}</span>
                                  Tất cả ({opts.length} đường kính)
                                </button>
                                <div className="border-t border-slate-100 max-h-52 overflow-y-auto custom-scrollbar">
                                  {matched.length === 0
                                    ? <p className="text-center py-4 text-[12px] text-slate-400">Không tìm thấy</p>
                                    : matched.map((p, i) => {
                                        const kw = filterDiameter.toLowerCase(); const idx = p.toLowerCase().indexOf(kw);
                                        return (
                                          <button key={i} onClick={() => { setFilterDiameter(p); setShowDiameterDropdown(false); }}
                                            className={cn("w-full text-left px-3 py-2 text-[12px] transition-colors flex items-center gap-2", filterDiameter === p ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50")}>
                                            <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center shrink-0">{filterDiameter === p && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 block" />}</span>
                                            <span className="truncate flex-1">{p.slice(0,idx)}{idx>=0&&<span className="bg-yellow-200 text-yellow-900 font-black rounded px-0.5">{p.slice(idx,idx+filterDiameter.length)}</span>}{idx>=0?p.slice(idx+filterDiameter.length):''}</span>
                                            <span className="ml-auto text-[11px] font-black text-slate-400 shrink-0">{history.filter(r => r.diameter === p).length}</span>
                                          </button>
                                        );
                                      })
                                  }
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Ngày kết thúc từ */}
                      <SmartDateInput 
                        label="Ngày kết thúc từ"
                        value={filterDateFrom}
                        onChange={setFilterDateFrom}
                      />
                      {/* Ngày kết thúc đến */}
                      <SmartDateInput 
                        label="Ngày kết thúc đến"
                        value={filterDateTo}
                        onChange={setFilterDateTo}
                      />
                    </div>
                  </div>
                )}

                {/* Table */}
                <div className="modern-card overflow-hidden">
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="pro-table">
                      <thead>
                        <tr>
                          <th className="text-center w-12">STT</th>
                          <th>Dự án</th>
                          <th>Hạng mục</th>
                          <th>Tên bộ phận</th>
                          <th>Số hiệu</th>
                          <th>Tên Máy khoan</th>
                          <th>Đường kính</th>
                          <th>Bắt đầu</th>
                          <th>Kết thúc</th>
                          <th className="text-center">Chiều dài (m)</th>
                          <th className="text-center">T.Gian TC (h)</th>
                          <th className="text-center">Vận tốc TB (m/h)</th>
                          <th className="text-center">File Dữ liệu</th>
                          <th className="text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={14} className="text-center py-16 text-slate-400">
                              <div className="flex flex-col items-center gap-3">
                                <Search size={32} className="opacity-30" />
                                <p className="text-sm font-bold uppercase tracking-widest">Không tìm thấy kết quả</p>
                                <button onClick={resetFilters} className="text-[10px] font-black text-blue-500 hover:underline uppercase tracking-widest">Xóa bộ lọc</button>
                              </div>
                            </td>
                          </tr>
                        ) : filtered.map((item, index) => (
                          <tr key={item.id} className="hover:bg-sky-50/80 transition-colors group">
                            <td className="text-center font-bold text-blue-700 text-xs">{(item as any).displayStt}</td>
                            <td className="font-normal text-blue-900">{item.project}</td>
                            <td className="text-slate-900 font-normal">{item.item}</td>
                            <td className="text-slate-900 font-normal">{item.componentName}</td>
                            <td className="font-normal text-blue-900 text-center">{item.pileId}</td>
                            <td className="font-normal text-slate-900">{item.reportNumber}</td>
                            <td className="font-normal text-slate-900 text-center">{item.diameter}</td>
                            <td className="text-slate-900 font-normal text-center">{item.constructionStart}</td>
                            <td className="text-slate-900 font-normal text-center">{item.constructionEnd}</td>
                            <td className="text-center font-bold text-orange-600">
                              {formatNumber((item.layers || []).reduce((acc, l) => acc + l.lengthMeters, 0))}
                            </td>
                            <td className="text-center text-slate-700">
                              {(() => {
                                const h = (item.layers || []).reduce((acc, l) => acc + l.durationHours, 0);
                                return h > 0 ? formatNumber(h) : '—';
                              })()}
                            </td>
                            <td className="text-center">
                              {(() => {
                                const totalLen = (item.layers || []).reduce((acc, l) => acc + l.lengthMeters, 0);
                                const h = (item.layers || []).reduce((acc, l) => acc + l.durationHours, 0);
                                const v = h > 0 ? totalLen / h : 0;
                                return (
                                  <span className={cn(
                                    "inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold",
                                    v > 5 ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"
                                  )}>
                                    {v > 0 ? formatNumber(v) : '—'}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="text-center">
                              {item.excelUrl ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDownloadExcel(item); }}
                                    disabled={downloadingExcelId === item.id}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-[11px] font-black uppercase tracking-wide transition-all shadow-sm",
                                      downloadingExcelId === item.id
                                        ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                        : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-600 hover:text-white"
                                    )}
                                    title="Tải file Excel (có ảnh biên bản)"
                                  >
                                    {downloadingExcelId === item.id ? (
                                      <><svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>...</>
                                    ) : (
                                      <><ArrowDownToLine size={12} />Excel</>
                                    )}
                                  </button>

                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-300 font-medium">—</span>
                              )}
                            </td>
                            <td className="text-center">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleEdit(item)}
                                  className="p-2 bg-sky-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-sky-100"
                                  title="Chỉnh sửa"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDelete(item.id)}
                                  className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-100"
                                  title="Xóa"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              );
            })() : (
              <div className="flex flex-col items-center justify-center py-32 bg-white border-2 border-dashed border-slate-200 rounded-[40px] animate-in fade-in duration-700">
                <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center text-blue-600 mb-8 shadow-inner">
                  <Upload size={48} />
                </div>
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight mb-3">Chưa có dữ liệu biên bản</h3>
                <p className="text-slate-500 max-w-md text-center mb-10 font-medium">
                  Hệ thống chưa ghi nhận biên bản nào. Hãy tải lên các tệp ảnh hoặc PDF của biên bản hiện trường để bắt đầu phân tích.
                </p>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-10 py-5 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl shadow-orange-900/20 flex items-center gap-4 active:scale-95"
                >
                  <Upload size={24} />
                  Tải lên biên bản ngay
                </button>
              </div>
            ))}
          </div>
            )} {/* end else: không có file */}
          </div>
        ) : activeSheet === 'pdf-splitter' ? (
          <PdfSplitterView />
        ) : activeSheet === 'geology' ? (
          <GeologyView />
        ) : (
          <SummaryView 
            history={history} 
            onSelectResult={(res) => { setCurrentResult({ ...res, layers: Array.isArray(res.layers) ? res.layers : [] }); setActiveSheet('upload'); }} 
            onEdit={handleEdit}
            onDelete={handleDelete}
            onUploadClick={() => { setActiveSheet('upload'); setTimeout(() => fileInputRef.current?.click(), 100); }}
            isExportingAll={isExportingAll}
            onExportAll={exportAllToExcel}
            githubCreds={githubCreds}
          />
        )}
      </main>

      {/* Settings Modal — Navy Dark Theme, A4 Landscape */}
      {isSettingsOpen && (
        <div className="fixed inset-0 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300"
          style={{background:'rgba(10,22,50,0.75)'}}>
          <div className="w-full rounded-2xl shadow-2xl overflow-hidden border"
            style={{maxWidth:'1100px', maxHeight:'92vh', display:'flex', flexDirection:'column',
              background:'linear-gradient(160deg,#1a3a6b 0%,#1e4480 50%,#163570 100%)',
              borderColor:'#2a4f8f'}}>

            {/* ── HEADER ── */}
            <div className="px-8 py-4 flex items-center justify-between shrink-0 border-b" style={{borderColor:'#2a4f8f'}}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)'}}>
                  <Settings size={18} className="text-sky-300" />
                </div>
                <div>
                  <h3 className="text-base font-black uppercase tracking-tight leading-none text-white">Cấu hình hệ thống</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{color:'#7eb8f7'}}>Quản lý API & Giao diện</p>
                </div>
              </div>
              <button onClick={() => setIsSettingsOpen(false)}
                className="p-2 rounded-full transition-colors text-sky-300 hover:text-white"
                style={{background:'rgba(255,255,255,0.05)'}}>
                <X size={18} />
              </button>
            </div>

            {/* ── BODY — 3 cột ── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-6 grid gap-5" style={{gridTemplateColumns:'1fr 1fr 1fr'}}>

                {/* ═══ CỘT 1: Logo + GitHub ═══ */}
                <div className="space-y-4">

                  {/* Logo */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2" style={{color:'#7eb8f7'}}>Logo tùy chỉnh</label>
                    <div className="flex items-center gap-3 p-3 rounded-xl border" style={{background:'rgba(255,255,255,0.06)', borderColor:'rgba(255,255,255,0.12)'}}>
                      <div className="w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border" style={{background:'rgba(255,255,255,0.1)', borderColor:'rgba(255,255,255,0.2)'}}>
                        {customLogo
                          ? <img src={customLogo} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          : <Construction className="w-6 h-6" style={{color:'#7eb8f7'}} />}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <button onClick={() => logoInputRef.current?.click()}
                          className="w-full py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 text-white hover:opacity-80"
                          style={{background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.2)'}}>
                          <ImageIcon size={13} /> Thay đổi Logo
                        </button>
                        {customLogo && (
                          <button onClick={resetLogo}
                            className="w-full py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 hover:opacity-80"
                            style={{background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5'}}>
                            <RotateCcw size={13} /> Đặt lại mặc định
                          </button>
                        )}
                      </div>
                      <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                    </div>
                  </div>

                  {/* GitHub */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2" style={{color:'#7eb8f7'}}>Kết nối GitHub</label>
                    <div className="rounded-xl border p-4 space-y-3" style={{background:'rgba(255,255,255,0.06)', borderColor:'rgba(255,255,255,0.12)'}}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg shrink-0" style={{background: isGithubConnected ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.08)'}}>
                          <Github size={16} style={{color: isGithubConnected ? '#34d399' : '#7eb8f7'}} />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-tight text-white">
                            {isGithubConnected ? "Đã kết nối GitHub" : "Chưa kết nối GitHub"}
                          </p>
                          <p className="text-[9px] font-bold uppercase tracking-widest leading-none mt-0.5" style={{color: isGithubConnected ? '#34d399' : '#7eb8f7'}}>
                            {isGithubConnected ? "Đang đồng bộ tự động" : "Điền thông tin để đồng bộ"}
                          </p>
                        </div>
                      </div>
                      {[
                        {label:'Personal Access Token', value:githubTokenInput, set:setGithubTokenInput, type:'password', ph:'ghp_xxxxxxxxxxxxxxxxxxxx'},
                        {label:'GitHub Username', value:githubUsernameInput, set:setGithubUsernameInput, type:'text', ph:'username'},
                        {label:'Repository Name', value:githubRepoInput, set:setGithubRepoInput, type:'text', ph:'construction-reports'},
                      ].map(f => (
                        <div key={f.label}>
                          <label className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{color:'rgba(255,255,255,0.5)'}}>{f.label}</label>
                          <input type={f.type} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.ph}
                            className="w-full px-3 py-2 rounded-lg text-sm font-medium outline-none transition-all text-white placeholder-white/30"
                            style={{background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)'}}
                            onFocus={e => e.currentTarget.style.borderColor='rgba(126,184,247,0.6)'}
                            onBlur={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.15)'} />
                        </div>
                      ))}
                      <button onClick={connectGithub} disabled={isConnectingGithub}
                        className="w-full py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                        style={isGithubConnected
                          ? {background:'rgba(52,211,153,0.15)', color:'#34d399', border:'1px solid rgba(52,211,153,0.3)'}
                          : {background:'#f97316', color:'#fff', border:'none'}}>
                        {isConnectingGithub ? "Đang lưu..." : isGithubConnected ? "✓ Cập nhật kết nối" : "Lưu & kết nối"}
                      </button>
                      {isGithubConnected && (
                        <button onClick={async () => {
                          if (!githubCreds) return;
                          if (!window.confirm(
                            "Tính năng này sẽ:\n" +
                            "• Quét toàn bộ thư mục SGC-CKN/ trên GitHub\n" +
                            "• So sánh với TẤT CẢ bản ghi trong Supabase\n" +
                            "• Xóa file ảnh/PDF/Excel không có trong Supabase\n\n" +
                            "Tiếp tục?"
                          )) return;

                          const { token, username, repo } = githubCreds;
                          const ghHeaders = { 'Authorization': `token ${token.trim()}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
                          const BASE_RAW = `https://raw.githubusercontent.com/${username}/${repo}/main`;
                          const BASE_API = `https://api.github.com/repos/${username}/${repo}/contents`;

                          // ── Bước 1: Lấy TẤT CẢ bản ghi Supabase (có phân trang) ──
                          // normalizeUrl: decode %xx, strip query string, lowercase → so sánh chính xác
                          const normalizeUrl = (u: string): string => {
                            if (!u) return '';
                            try { return decodeURIComponent(u.split('?')[0].trim()).toLowerCase(); }
                            catch { return u.split('?')[0].trim().toLowerCase(); }
                          };
                          const validUrls = new Set<string>();
                          if (supabase) {
                            let page = 0;
                            const PAGE_SIZE = 1000;
                            while (true) {
                              const { data, error } = await supabase
                                .from('drill_extractions')
                                .select('excelUrl, fileUrl')
                                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
                              if (error || !data || data.length === 0) break;
                              data.forEach((r: any) => {
                                if (r.excelUrl) validUrls.add(normalizeUrl(r.excelUrl));
                                if (r.fileUrl) validUrls.add(normalizeUrl(r.fileUrl));
                              });
                              if (data.length < PAGE_SIZE) break;
                              page++;
                            }
                          }
                          console.log(`[Cleanup] Supabase valid URLs (${validUrls.size}):`, [...validUrls]);

                          // ── Bước 2: Hàm lấy danh sách file trong 1 thư mục GitHub ──
                          const listDir = async (path: string): Promise<{path:string, sha:string, name:string}[]> => {
                            const res = await fetch(`${BASE_API}/${path}`, { headers: ghHeaders });
                            if (!res.ok) return [];
                            const items = await res.json();
                            if (!Array.isArray(items)) return [];
                            return items.filter((f:any) => f.type === 'file');
                          };

                          // ── Bước 3: Quét cả 2 thư mục ──
                          let deleted = 0;
                          let skipped = 0;
                          const deletedFiles: string[] = [];
                          const keptFiles: string[] = [];

                          try {
                            // Quét thư mục gốc SGC-CKN/ (ảnh + PDF)
                            const rootFiles = await listDir('SGC-CKN');
                            // Quét thư mục Excel
                            const excelFiles = await listDir('SGC-CKN/Excel');
                            const allFiles = [...rootFiles, ...excelFiles];

                            console.log(`[Cleanup] GitHub total files: ${allFiles.length}`);

                            for (const f of allFiles) {
                              const rawUrl = `${BASE_RAW}/${f.path}`;
                              // So sánh sau khi normalize cả 2 phía
                              const isValid = validUrls.has(normalizeUrl(rawUrl));
                              console.log(`[Cleanup] ${isValid ? 'KEEP' : 'DELETE'}: ${f.path}`);

                              if (!isValid) {
                                const delRes = await fetch(`${BASE_API}/${f.path}`, {
                                  method: 'DELETE',
                                  headers: ghHeaders,
                                  body: JSON.stringify({ message: `[SGC-CKN] Dọn rác: xóa file mồ côi ${f.name}`, sha: f.sha })
                                });
                                if (delRes.ok) {
                                  deleted++;
                                  deletedFiles.push(f.name);
                                } else {
                                  const err = await delRes.json().catch(()=>({}));
                                  console.error(`[Cleanup] Lỗi xóa ${f.path}:`, err);
                                }
                              } else {
                                skipped++;
                                keptFiles.push(f.name);
                              }
                            }
                          } catch (e) {
                            console.error('[Cleanup] Lỗi quét GitHub:', e);
                          }

                          // ── Kết quả ──
                          if (deleted > 0) {
                            alert(
                              `✅ Dọn rác hoàn tất!\n\n` +
                              `🗑 Đã xóa ${deleted} file mồ côi:\n` +
                              deletedFiles.map(n => `  • ${n}`).join('\n') +
                              `\n\n✓ Giữ lại ${skipped} file đang dùng`
                            );
                          } else {
                            alert(`✅ GitHub sạch! ${skipped} file đang dùng, không có file mồ côi.`);
                          }
                        }}
                          className="w-full py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                          style={{background:'rgba(239,68,68,0.12)', color:'#fca5a5', border:'1px solid rgba(239,68,68,0.25)'}}>
                          <Trash2 size={12} /> Dọn rác GitHub
                        </button>
                      )}
                    </div>
                  </div>
                </div>{/* end col 1 */}

                {/* ═══ CỘT 2: Gemini API Keys ═══ */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] block" style={{color:'#7eb8f7'}}>Gemini API Keys</label>
                  <p className="text-[10px] font-bold uppercase tracking-widest -mt-2" style={{color:'rgba(255,255,255,0.35)'}}>Tự động xoay vòng khi hết quota</p>

                  {/* Thanh trạng thái */}
                  <div className="flex gap-1.5">
                    {geminiApiKeys.map((k, i) => {
                      const hasKey = k.trim().length > 0;
                      const isActive = hasKey && i === activeKeyIndex && !exhaustedKeys.has(i);
                      const isExhausted = hasKey && exhaustedKeys.has(i);
                      return (
                        <div key={i}
                          title={isActive ? `Key #${i+1} đang dùng` : isExhausted ? `Key #${i+1} hết quota` : !hasKey ? `Key #${i+1} chưa điền` : `Key #${i+1} sẵn sàng`}
                          className="flex-1 h-2 rounded-full transition-all"
                          style={{background: isActive ? '#34d399' : isExhausted ? '#f87171' : hasKey ? '#7eb8f7' : 'rgba(255,255,255,0.15)'}} />
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {geminiApiKeys.map((k, i) => {
                      const hasKey = k.trim().length > 0;
                      const isActive = hasKey && i === activeKeyIndex && !exhaustedKeys.has(i);
                      const isExhausted = hasKey && exhaustedKeys.has(i);
                      return (
                        <span key={i} className="flex-1 text-center text-[9px] font-black uppercase tracking-widest"
                          style={{color: isActive ? '#34d399' : isExhausted ? '#f87171' : hasKey ? '#7eb8f7' : 'rgba(255,255,255,0.25)'}}>
                          {isActive ? '● Dùng' : isExhausted ? '✕ Quota' : hasKey ? '○ Sẵn' : `K${i+1}`}
                        </span>
                      );
                    })}
                  </div>

                  {/* 5 ô key */}
                  {geminiApiKeys.map((k, i) => {
                    const isActive = !!k.trim() && i === activeKeyIndex && !exhaustedKeys.has(i);
                    const isExhausted = !!k.trim() && exhaustedKeys.has(i);
                    const borderCol = isActive ? 'rgba(52,211,153,0.5)' : isExhausted ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.15)';
                    const bgCol = isActive ? 'rgba(52,211,153,0.08)' : isExhausted ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.06)';
                    const textCol = isActive ? '#34d399' : isExhausted ? '#fca5a5' : '#e2eeff';
                    return (
                      <div key={i} className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black"
                          style={{background: isActive ? '#34d399' : isExhausted ? '#f87171' : 'rgba(255,255,255,0.15)', color: isActive || isExhausted ? '#fff' : 'rgba(255,255,255,0.6)'}}>
                          {i + 1}
                        </div>
                        <input type="password" value={k}
                          onChange={(e) => { const next = [...geminiApiKeys]; next[i] = e.target.value; setGeminiApiKeys(next); }}
                          placeholder={i === 0 ? 'API Key #1 (chính)' : `API Key #${i+1} (dự phòng ${i})`}
                          className="w-full pl-10 pr-24 py-2.5 rounded-xl text-sm font-medium outline-none transition-all placeholder-white/25"
                          style={{background:bgCol, border:`1px solid ${borderCol}`, color:textCol}} />
                        {isActive && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest" style={{color:'#34d399'}}>Đang dùng</span>}
                        {isExhausted && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase tracking-widest" style={{color:'#fca5a5'}}>Hết quota</span>}
                      </div>
                    );
                  })}

                  {geminiApiKeys.some(k => k.trim()) && exhaustedKeys.size > 0 && geminiApiKeys.every((k, i) => !k.trim() || exhaustedKeys.has(i)) && (
                    <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.3)'}}>
                      <span className="text-lg mt-0.5">⛔</span>
                      <div>
                        <p className="font-black text-[11px] uppercase tracking-widest" style={{color:'#fca5a5'}}>Tất cả API Key đã hết quota!</p>
                        <p className="text-[11px] mt-0.5" style={{color:'rgba(252,165,165,0.7)'}}>Thêm key mới vào ô trống hoặc chờ quota reset (sau 24h).</p>
                      </div>
                    </div>
                  )}

                  <button onClick={() => { setExhaustedKeys(new Set()); setActiveKeyIndex(0); }}
                    className="text-[10px] font-bold uppercase tracking-widest transition-colors"
                    style={{color:'#7eb8f7'}}
                    onMouseEnter={e => (e.currentTarget.style.color='#bfdbfe')}
                    onMouseLeave={e => (e.currentTarget.style.color='#7eb8f7')}>
                    ↺ Reset quota — thử lại từ Key #1
                  </button>
                </div>{/* end col 2 */}

                {/* ═══ CỘT 3: Hướng dẫn + Trạng thái + Nút Lưu ═══ */}
                <div className="flex flex-col gap-4">

                  {/* Hướng dẫn */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2" style={{color:'#7eb8f7'}}>Hướng dẫn sử dụng</label>
                    <div className="rounded-xl p-4 space-y-3" style={{background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)'}}>
                      {[
                        {n:'1', col:'#7eb8f7', title:'GitHub Token:', body:'Vào github.com → Settings → Developer settings → Personal access tokens → Tạo token với quyền repo'},
                        {n:'2', col:'#7eb8f7', title:'Gemini API Key:', body:'Vào aistudio.google.com → Get API Key → Tạo key miễn phí (1,500 req/ngày)'},
                        {n:'3', col:'#7eb8f7', title:'Xoay vòng Key:', body:'Thêm nhiều key vào ô 2–5, hệ thống tự chuyển khi key #1 hết quota'},
                        {n:'✓', col:'#34d399', title:'Dọn rác GitHub:', body:'Xóa file Excel & ảnh cũ không liên kết trong database, giải phóng dung lượng repo'},
                      ].map(item => (
                        <div key={item.n} className="flex gap-2 text-[12px]">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 mt-0.5 text-white"
                            style={{background: item.col === '#34d399' ? '#34d399' : 'rgba(126,184,247,0.3)'}}>
                            {item.n}
                          </span>
                          <p style={{color:'rgba(255,255,255,0.65)'}}><span className="font-black" style={{color:'rgba(255,255,255,0.9)'}}>{item.title}</span> {item.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Trạng thái hệ thống */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] block mb-2" style={{color:'#7eb8f7'}}>Trạng thái hệ thống</label>
                    <div className="rounded-xl p-4 space-y-2.5" style={{background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)'}}>
                      {[
                        {name:'Supabase', ok:!!supabase, okLabel:'● Đã kết nối', nokLabel:'○ Chưa kết nối'},
                        {name:'GitHub', ok:isGithubConnected, okLabel:'● Đã kết nối', nokLabel:'○ Chưa kết nối'},
                      ].map(item => (
                        <div key={item.name} className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:'rgba(255,255,255,0.5)'}}>{item.name}</span>
                          <span className="text-[11px] font-black uppercase tracking-widest" style={{color: item.ok ? '#34d399' : '#fbbf24'}}>
                            {item.ok ? item.okLabel : item.nokLabel}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:'rgba(255,255,255,0.5)'}}>Gemini AI</span>
                        <span className="text-[11px] font-black uppercase tracking-widest"
                          style={{color: geminiApiKeys.some(k=>k.trim())
                            ? exhaustedKeys.size > 0 && geminiApiKeys.every((k,i)=>!k.trim()||exhaustedKeys.has(i)) ? '#f87171' : '#34d399'
                            : '#fbbf24'}}>
                          {geminiApiKeys.some(k=>k.trim())
                            ? exhaustedKeys.size > 0 && geminiApiKeys.every((k,i)=>!k.trim()||exhaustedKeys.has(i))
                              ? '⛔ Hết quota' : `● ${geminiApiKeys.filter(k=>k.trim()).length} key sẵn sàng`
                            : '○ Chưa có key'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Nút Lưu */}
                  <div className="mt-auto">
                    <button onClick={() => saveAllApiKeys(geminiApiKeys)}
                      className="w-full py-4 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95 text-white"
                      style={{background:'linear-gradient(135deg,#2563eb,#1d4ed8)', boxShadow:'0 4px 20px rgba(37,99,235,0.4)'}}>
                      <Save size={18} />
                      Lưu cấu hình
                    </button>
                  </div>
                </div>{/* end col 3 */}

              </div>
            </div>{/* end body */}
          </div>
        </div>
      )}




      <footer className="bg-sky-50 border-t border-sky-200 px-8 py-4 text-center mt-auto">
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.4em]">
          Hệ thống SGC - CKN • Giải pháp dữ liệu xây dựng
        </p>
      </footer>

      {/* ── Conflict Dialog: cùng số TT địa chất nhưng lớp thiết kế khác nhau ── */}
      {conflictDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-black text-[15px] uppercase tracking-tight">Phát hiện dữ liệu không nhất quán</h3>
                <p className="text-orange-100 text-[11px] font-medium">AI có thể đã quét sai mô tả lớp địa chất</p>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-slate-700 text-sm font-medium">
                Cùng <span className="font-black text-blue-700">số thứ tự địa chất thực tế</span> nhưng có <span className="font-black text-red-600">mô tả lớp thiết kế khác nhau</span>:
              </p>

              <div className="space-y-3 max-h-60 overflow-y-auto">
                {conflictDialog.conflicts.map(({ geology, designs }) => (
                  <div key={geology} className="border border-red-200 rounded-xl overflow-hidden">
                    <div className="bg-red-50 px-4 py-2 flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-red-500 text-white text-[12px] font-black flex items-center justify-center shrink-0">{geology}</span>
                      <span className="text-red-700 font-black text-[12px] uppercase tracking-wider">Địa chất thực tế số {geology} — {designs.length} mô tả khác nhau</span>
                    </div>
                    <div className="divide-y divide-red-100">
                      {designs.map((d, i) => (
                        <div key={i} className="px-4 py-2 flex items-start gap-2">
                          <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${i === 0 ? 'bg-blue-400' : 'bg-orange-400'}`} />
                          <span className="text-slate-700 text-[12px]">{d}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-[12px] font-medium">
                💡 Khuyến nghị: Kiểm tra lại biên bản gốc và chỉnh sửa trước khi lưu để đảm bảo dữ liệu chính xác.
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => {
                  setConflictDialog(null);
                  // Mở edit modal để chỉnh sửa
                  setEditingResult(JSON.parse(JSON.stringify(conflictDialog.result)));
                  setIsEditModalOpen(true);
                }}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[12px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                <Edit2 size={14} /> Chỉnh sửa ngay
              </button>
              <button
                onClick={conflictDialog.onForce}
                className="flex-1 py-3 bg-orange-100 hover:bg-orange-200 text-orange-700 border border-orange-200 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all"
              >
                Vẫn lưu
              </button>
              <button
                onClick={() => setConflictDialog(null)}
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Split View Modal */}
      {isEditModalOpen && editingResult && (
        <EditSplitView 
          result={editingResult} 
          onClose={() => { setIsEditModalOpen(false); setEditingResult(null); }}
          onSave={handleSaveEdit}
          githubCreds={githubCreds}
          userApiKey={userApiKey}
          onExtract={callExtractWithRotation}
        />
      )}
    </div>
  );
}

function ResultDisplay({ result, onSave, onCancel }: { result: ExtractionResult; onSave?: (res: ExtractionResult) => void; onCancel?: (id: string) => void }) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      {/* Review Actions */}
      {(onSave || onCancel) && (
        <div className="flex items-center justify-between bg-white border border-slate-200 p-8 rounded-3xl shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500" />
          <div className="flex items-center gap-5">
            <div className="bg-orange-50 p-3 rounded-2xl text-orange-600">
              <AlertCircle size={24} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-slate-900 uppercase tracking-tight">Kiểm tra dữ liệu trích xuất</h4>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Dữ liệu cần được xác nhận trước khi lưu</p>
            </div>
          </div>
          <div className="flex gap-4">
            {onCancel && (
              <button 
                onClick={() => onCancel(result.id)}
                className="px-6 py-3 bg-white text-slate-400 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all border border-slate-200 shadow-sm flex items-center gap-2"
              >
                <X size={16} />
                Hủy bỏ
              </button>
            )}
            {onSave && (
              <button 
                onClick={() => onSave(result)}
                className="px-8 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center gap-2"
              >
                <Save size={16} />
                Lưu dữ liệu
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats + Detail - chỉ hiện sau khi đã lưu */}
      {!(onSave || onCancel) && (
      <div className="space-y-8">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <StatCard title="Số hiệu cọc" value={result.pileId} icon={<Layers className="text-blue-600" />} />
        <StatCard title="Tên Máy khoan" value={result.reportNumber} icon={<FileText className="text-blue-600" />} />
        <StatCard title="Đường kính" value={result.diameter} icon={<Activity className="text-blue-600" />} />
        <StatCard title="Tổng chiều sâu" value={`${formatNumber((result.layers || []).reduce((acc, l) => acc + l.lengthMeters, 0))} m`} icon={<ArrowDownToLine className="text-orange-600" />} />
        <StatCard title="Bắt đầu" value={result.constructionStart} icon={<Calendar className="text-blue-600" />} />
        <StatCard title="Kết thúc" value={result.constructionEnd} icon={<Calendar className="text-blue-600" />} />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-[18px] font-black text-black tracking-tight flex items-center gap-3 uppercase">
            <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
            Chi tiết các lớp địa chất
          </h3>
          <p className="text-xs text-slate-900 font-medium ml-4">Thông số kỹ thuật trích xuất từ biên bản</p>
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-1.5 bg-slate-50 text-black rounded-lg text-[10px] font-bold uppercase tracking-widest border border-slate-300">
            {(result.layers || []).length} Lớp
          </div>
          <div className="px-3 py-1.5 bg-slate-50 text-black rounded-lg text-[10px] font-bold uppercase tracking-widest border border-slate-300">
            TB: {formatNumber((result.layers || []).reduce((acc, l) => acc + l.speedMph, 0) / ((result.layers || []).length || 1))} m/h
          </div>
        </div>
      </div>

      {(() => {
        // Lookup map: cùng layerDesign → ưu tiên soilClass đã phân định
        const soilLookup = new Map<string, string>();
        (result.layers || []).forEach(l => {
          const k = (l.layerDesign || '').trim();
          if (!k) return;
          const sc = SOIL_CLASSES.includes((l.soilClass || '').trim()) ? l.soilClass.trim() : 'Chưa Phân định nhóm';
          if (!soilLookup.has(k) || soilLookup.get(k) === 'Chưa Phân định nhóm') soilLookup.set(k, sc);
        });
        const soilBadgeColors: Record<string, string> = {
          'Đất cấp I':   'bg-yellow-100 text-yellow-800 border-yellow-300',
          'Đất cấp II':  'bg-emerald-100 text-emerald-800 border-emerald-300',
          'Đất cấp III': 'bg-orange-100 text-orange-800 border-orange-300',
          'Đá cấp I':    'bg-rose-100 text-rose-800 border-rose-300',
          'Chưa Phân định nhóm': 'bg-slate-100 text-slate-500 border-slate-300',
        };
        return (
      <div className="modern-card overflow-hidden border border-slate-300 shadow-sm">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse table-fixed min-w-[1500px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="sticky left-0 bg-slate-100 z-20 px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[80px]">ĐỊA CHẤT <br/> THỰC TẾ</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Tên Máy khoan</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Đường kính</th>
                <th className="px-4 py-3 text-left text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[350px]">Mô tả lớp thiết kế</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">Cấp đất đá</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">Từ (h)</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">Đến (h)</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Cao độ từ</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Cao độ đến</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[80px]">T.Gian</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[80px]">Dài (m)</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">V (m/h)</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider w-[200px]">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {result.layers.map((layer, idx) => (
                <tr key={idx} className="group hover:bg-slate-50 transition-colors">
                  <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 text-center font-bold text-blue-700 px-4 py-3 text-[12px] border-r border-slate-200">
                    <div className="text-sm">{getGeoDisplay(layer)}</div>
                  </td>
                  <td className="text-black px-4 py-3 text-[12px] border-r border-slate-200 text-center">{result.reportNumber}</td>
                  <td className="text-black px-4 py-3 text-[12px] border-r border-slate-200 text-center">{layer.diameter}</td>
                  <td className="text-black italic text-[12px] leading-relaxed px-4 py-3 border-r border-slate-200 whitespace-pre-wrap break-words">{layer.layerDesign}</td>
                  <td className="px-4 py-3 text-[11px] border-r border-slate-200 text-center">
                    {(() => {
                      const sc = soilLookup.get((layer.layerDesign || '').trim()) || 'Chưa Phân định nhóm';
                      return (
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${soilBadgeColors[sc] || soilBadgeColors['Chưa Phân định nhóm']}`}>
                          {sc === 'Chưa Phân định nhóm' ? 'Chưa PĐN' : sc}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="font-normal text-black px-4 py-3 text-[12px] border-r border-slate-200 text-center">
                    <div>{layer.timeFrom}</div>
                    {layer.dateFrom && <div className="text-[9px] text-slate-500">{layer.dateFrom}</div>}
                  </td>
                  <td className="font-normal text-black px-4 py-3 text-[12px] border-r border-slate-200 text-center">
                    <div>{layer.timeTo}</div>
                    {layer.dateTo && <div className="text-[9px] text-slate-500">{layer.dateTo}</div>}
                  </td>
                  <td className="text-center text-black px-4 py-3 text-[12px] border-r border-slate-200">{formatNumber(layer.elevationFrom)}</td>
                  <td className="text-center text-black px-4 py-3 text-[12px] border-r border-slate-200">{formatNumber(layer.elevationTo)}</td>
                  <td className="text-center font-normal text-black bg-slate-50 px-4 py-3 text-[12px] border-r border-slate-200">{formatNumber(layer.durationHours)}</td>
                  <td className="text-center font-normal text-black px-4 py-3 text-[12px] border-r border-slate-200">{formatNumber(layer.lengthMeters)}</td>
                  <td className={cn(
                    "text-center font-bold px-4 py-3 text-[12px] border-r border-slate-200",
                    layer.speedMph <= 1 ? "text-white bg-red-600" : "text-orange-700 bg-orange-50/30"
                  )}>
                    {formatNumber(layer.speedMph)}
                  </td>
                  <td className="text-center text-slate-600 px-4 py-3 text-[12px] italic whitespace-normal leading-relaxed">{layer.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
        );
      })()}

      <div className="grid grid-cols-1 gap-8">
        <div className="modern-card p-10 flex flex-col justify-center items-center text-center">
          <h4 className="text-slate-900 font-bold uppercase tracking-widest text-[10px] mb-4">Tốc độ khoan trung bình</h4>
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-bold text-black tracking-tighter">
              {formatNumber((result.layers || []).reduce((acc, l) => acc + l.speedMph, 0) / ((result.layers || []).length || 1))}
            </span>
            <span className="text-slate-900 font-bold uppercase tracking-widest text-xs">m/h</span>
          </div>
          <div className="mt-8 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 transition-all duration-1000" 
              style={{ width: `${Math.min(100, ((result.layers || []).reduce((acc, l) => acc + l.speedMph, 0) / ((result.layers || []).length || 1)) * 10)}%` }} 
            />
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

function PdfSplitterView() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pages, setPages] = useState<{ name: string; blob: Blob; url: string; thumbnail: string }[]>([]);
  const [previewPage, setPreviewPage] = useState<{ url: string; name: string; index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prefixText, setPrefixText] = useState<string>('');

  // Helper: build tên file theo format NgayThang_NoiDung_TenFile_Trang_N.pdf
  const buildPageName = (baseName: string, pageNum: number, prefix: string): string => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;
    const safePrefix = prefix.trim().replace(/[^a-zA-Z0-9À-ỹĂăÂâĐđÊêÔôƠơƯư\s_\-]/g, '').trim().replace(/\s+/g, '_');
    const parts = [dateStr, safePrefix, baseName, `Trang_${pageNum}`].filter(Boolean);
    return parts.join('_') + '.pdf';
  };

  // Render 1 trang PDF thành ảnh thumbnail bằng pdfjs
  const renderPageThumbnail = async (pdfBytes: Uint8Array, scale = 0.5): Promise<string> => {
    const loadingTask = pdfjs.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await (page as any).render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const processFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setPages([]);
    setProgress(0);
    setIsProcessing(true);
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pageCount = pdfDoc.getPageCount();
      const newPages: typeof pages = [];

      for (let i = 0; i < pageCount; i++) {
        // Tách trang thành PDF riêng
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
        newPdf.addPage(copiedPage);
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const name = buildPageName(selectedFile.name.replace(/\.pdf$/i, ''), i + 1, prefixText);

        // Render thumbnail
        let thumbnail = '';
        try {
          thumbnail = await renderPageThumbnail(pdfBytes);
        } catch {}

        newPages.push({ name, blob, url, thumbnail });
        setProgress(Math.round(((i + 1) / pageCount) * 100));
      }
      setPages(newPages);
    } catch (error) {
      console.error('Error splitting PDF:', error);
      alert('Có lỗi xảy ra khi tách file PDF.');
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      processFile(selectedFile);
    } else if (selectedFile) {
      alert('Vui lòng chọn file PDF.');
    }
  };

  const downloadAll = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const zip = new JSZip();
      for (const page of pages) { zip.file(page.name, page.blob); }
      const content = await zip.generateAsync({ type: 'blob' });
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      const dateStr = `${dd}-${mm}-${yyyy}`;
      const safePrefix = prefixText.trim().replace(/[^a-zA-Z0-9À-ỹĂăÂâĐđÊêÔôƠơƯư\s_\-]/g, '').trim().replace(/\s+/g, '_');
      const zipParts = [dateStr, safePrefix, file?.name.replace(/\.pdf$/i, ''), 'Tach_File'].filter(Boolean);
      saveAs(content, zipParts.join('_') + '.zip');
    } catch (error) {
      alert('Có lỗi xảy ra khi tạo file nén.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Re-derive display names live based on current prefixText (without re-splitting)
  const displayPages = React.useMemo(() => {
    if (!file) return pages;
    return pages.map((p, i) => ({
      ...p,
      name: buildPageName(file.name.replace(/\.pdf$/i, ''), i + 1, prefixText),
    }));
  }, [pages, prefixText, file]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
          <div>
            <h3 className="text-[18px] font-black text-black uppercase tracking-tight">Tách file PDF</h3>
            <p className="text-xs text-slate-500 font-medium">Tự động tách PDF nhiều trang — xem preview từng trang trước khi tải</p>
          </div>
        </div>
        {/* Ô nhập nội dung chèn thêm — nằm giữa header */}
        <div className="flex-1 min-w-0 max-w-xl">
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <Edit2 size={14} />
            </div>
            <input
              type="text"
              value={prefixText}
              onChange={e => setPrefixText(e.target.value)}
              placeholder="Nội dung chèn thêm vào tên file (tuỳ chọn)..."
              className="w-full pl-9 pr-4 py-2.5 border-2 border-slate-200 hover:border-blue-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl text-[13px] font-medium text-slate-800 placeholder-slate-400 outline-none transition-all bg-white shadow-sm"
            />
          </div>
          {prefixText.trim() && (
            <p className="text-[10px] text-slate-400 font-medium mt-1 ml-1 truncate">
              📄 Tên file: <span className="text-blue-600 font-bold">
                {(() => {
                  const today = new Date();
                  const dd = String(today.getDate()).padStart(2,'0');
                  const mm = String(today.getMonth()+1).padStart(2,'0');
                  const yyyy = today.getFullYear();
                  const safe = prefixText.trim().replace(/[^a-zA-Z0-9À-ỹĂăÂâĐđÊêÔôƠơƯư\s_\-]/g,'').replace(/\s+/g,'_');
                  return `${dd}-${mm}-${yyyy}_${safe}_TênFile_Trang_N.pdf`;
                })()}
              </span>
            </p>
          )}
        </div>

        {pages.length > 0 && (
          <button
            onClick={downloadAll}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl text-[12px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/30 shrink-0"
          >
            <ArrowDownToLine size={15} />
            Tải tất cả ({pages.length} trang)
          </button>
        )}
      </div>

      {/* Upload zone */}
      <div
        className="bg-white border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-3xl p-8 flex flex-col items-center text-center gap-4 transition-all cursor-pointer group"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f?.type === 'application/pdf') processFile(f);
        }}
      >
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/pdf" className="hidden" />
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${file ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-500 group-hover:bg-blue-100'}`}>
          {isProcessing ? <Loader2 size={32} className="animate-spin" /> : <Scissors size={32} />}
        </div>
        {isProcessing ? (
          <div className="space-y-3 w-full max-w-xs">
            <p className="text-sm font-black text-blue-700 uppercase tracking-widest">Đang tách & render preview...</p>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 font-bold">{progress}% — đang xử lý từng trang</p>
          </div>
        ) : file && pages.length > 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-black text-slate-800">{file.name}</p>
            <p className="text-xs text-emerald-600 font-bold">✓ Đã tách {pages.length} trang — click để đổi file</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-base font-black text-slate-800">Kéo thả hoặc click để chọn file PDF</p>
            <p className="text-xs text-slate-400 font-medium">Hệ thống tự động tách và hiển thị preview từng trang</p>
          </div>
        )}
      </div>

      {/* Page grid with thumbnails */}
      {pages.length > 0 && (
        <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <FileText size={15} className="text-blue-500" />
              {pages.length} trang — click vào trang để xem to
            </h4>
            <p className="text-[11px] text-slate-400 font-medium">Hover để xem nút tải xuống từng trang</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {displayPages.map((page, i) => (
              <div
                key={i}
                className="group relative bg-white border-2 border-slate-200 hover:border-blue-400 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer"
                onClick={() => setPreviewPage({ url: page.url, name: page.name, index: i })}
              >
                {/* Thumbnail */}
                <div className="relative bg-slate-50" style={{ paddingBottom: '141%' }}>
                  {page.thumbnail ? (
                    <img
                      src={page.thumbnail}
                      alt={`Trang ${i + 1}`}
                      className="absolute inset-0 w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <FileText size={32} className="text-slate-300" />
                    </div>
                  )}
                  {/* Overlay khi hover */}
                  <div className="absolute inset-0 bg-blue-900/0 group-hover:bg-blue-900/20 transition-all flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100">
                      <div className="bg-white rounded-full p-2.5 shadow-lg">
                        <ZoomInIcon size={18} className="text-blue-600" />
                      </div>
                    </div>
                  </div>
                  {/* Page number badge */}
                  <div className="absolute top-2 left-2 bg-[#1a3a6b] text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow">
                    Trang {i + 1}
                  </div>
                </div>

                {/* Footer: tên file + nút tải */}
                <div className="px-2.5 py-2 flex items-center justify-between gap-1 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-slate-600 truncate flex-1" title={page.name}>
                    {page.name.split('_Trang_')[1]?.replace('.pdf','') ? `Trang ${i+1}` : page.name}
                  </span>
                  <a
                    href={page.url}
                    download={page.name}
                    onClick={e => e.stopPropagation()}
                    className="shrink-0 p-1.5 bg-emerald-50 hover:bg-emerald-500 text-emerald-600 hover:text-white rounded-lg transition-all"
                    title={`Tải ${page.name}`}
                  >
                    <ArrowDownToLine size={13} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen preview modal */}
      {previewPage && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewPage(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-2xl w-full max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100" style={{ background: 'linear-gradient(135deg, #1a3a6b, #1e4480)' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                  <FileText size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-[13px]">Trang {previewPage.index + 1} / {pages.length}</p>
                  <p className="text-blue-200 text-[10px] font-medium truncate max-w-[280px]">{previewPage.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Prev / Next */}
                <button
                  disabled={previewPage.index === 0}
                  onClick={() => setPreviewPage({ url: pages[previewPage.index - 1].url, name: pages[previewPage.index - 1].name, index: previewPage.index - 1 })}
                  className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg disabled:opacity-30 transition-all"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  disabled={previewPage.index === pages.length - 1}
                  onClick={() => setPreviewPage({ url: pages[previewPage.index + 1].url, name: pages[previewPage.index + 1].name, index: previewPage.index + 1 })}
                  className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg disabled:opacity-30 transition-all"
                >
                  <ChevronRight size={16} />
                </button>
                <a
                  href={previewPage.url}
                  download={previewPage.name}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                >
                  <ArrowDownToLine size={13} /> Tải xuống
                </a>
                <button onClick={() => setPreviewPage(null)} className="p-2 bg-white/10 hover:bg-red-500 text-white rounded-lg transition-all">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Preview image */}
            <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center p-4">
              {displayPages[previewPage.index]?.thumbnail ? (
                <img
                  src={displayPages[previewPage.index].thumbnail}
                  alt={previewPage.name}
                  className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-lg"
                  draggable={false}
                />
              ) : (
                <div className="text-slate-400 text-center space-y-2">
                  <FileText size={48} className="mx-auto opacity-30" />
                  <p className="text-sm font-bold">Không có preview</p>
                </div>
              )}
            </div>

            {/* Thumbnail strip bottom */}
            {pages.length > 1 && (
              <div className="flex gap-2 p-3 border-t border-slate-100 overflow-x-auto bg-slate-50">
                {pages.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setPreviewPage({ url: p.url, name: p.name, index: i })}
                    className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all ${i === previewPage.index ? 'border-blue-500 shadow-md scale-105' : 'border-slate-200 hover:border-blue-300'}`}
                    style={{ width: 48, height: 68 }}
                  >
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={`T${i+1}`} className="w-full h-full object-contain bg-white" />
                    ) : (
                      <div className="w-full h-full bg-slate-100 flex items-center justify-center text-[9px] font-bold text-slate-400">{i+1}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weekly Report Utilities ──
function getWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  return `${fmt(weekStart)} – ${fmt(end)}/${end.getFullYear()}`;
}

// Format date as YYYY-MM-DD dùng local time (tránh bug UTC lệch múi giờ GMT+7)
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getWeekKey(d: Date): string {
  // Tuần bắt đầu Thứ 6 (day=5), kết thúc Thứ 5 (day=4)
  const day = d.getDay(); // 0=CN,1=T2,...,5=T6,6=T7
  // Số ngày kể từ Thứ 6 gần nhất: T6=0, T7=1, CN=2, T2=3, T3=4, T4=5, T5=6
  const daysSinceFri = (day + 2) % 7;
  const fri = new Date(d);
  fri.setHours(0, 0, 0, 0);
  fri.setDate(fri.getDate() - daysSinceFri);
  return toLocalDateKey(fri); // dùng local time, không dùng toISOString()
}

function getWeekStartDate(key: string): Date {
  // Parse YYYY-MM-DD trực tiếp thành local date (không qua UTC)
  const [y, m, dd] = key.split('-').map(Number);
  return new Date(y, m - 1, dd);
}

function parseViDate(str: string): Date | null {
  if (!str) return null;
  // Tìm DD/MM/YYYY ở bất kỳ vị trí nào (field có thể chứa cả giờ phút: "15:50\n24/02/2026")
  const dmyMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) return new Date(+dmyMatch[3], +dmyMatch[2]-1, +dmyMatch[1]);
  // ISO: YYYY-MM-DD
  const isoMatch = str.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (isoMatch) return new Date(+isoMatch[1], +isoMatch[2]-1, +isoMatch[3]);
  return null;
}

function SummaryView({ 
  history, 
  onSelectResult, 
  onEdit, 
  onDelete,
  onUploadClick,
  isExportingAll,
  onExportAll,
  githubCreds,
}: { 
  history: ExtractionResult[], 
  onSelectResult: (res: ExtractionResult) => void,
  onEdit: (res: ExtractionResult) => void,
  onDelete: (id: string) => void,
  onUploadClick: () => void,
  isExportingAll: boolean,
  onExportAll: (rows: ExtractionResult[]) => void,
  githubCreds: { token: string; username: string; repo: string } | null;
}) {
  const [dashTab, setDashTab] = useState<'overview' | 'weekly'>('overview');
  const [isExportingWeekly, setIsExportingWeekly] = useState(false);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [soilDrillDown, setSoilDrillDown] = useState<{ diameter: string; soilClass: string; piles: ExtractionResult[] } | null>(null);

  // Năm mặc định = năm có dữ liệu mới nhất (không phải năm hiện tại)
  const defaultYear = React.useMemo(() => {
    for (const r of history) {
      const d = parseViDate(r.constructionEnd);
      if (d) return d.getFullYear();
    }
    return new Date().getFullYear();
  }, [history]);
  const [weeklyYear, setWeeklyYear] = useState<number>(defaultYear);
  const projects = [...new Set(history.map(r => r.project).filter(Boolean))];
  // Đếm tổng số biên bản (mỗi file/biên bản được coi là 1 thực thể cọc trong thống kê này nếu người dùng muốn khớp với số lượng file đã upload)
  const totalPiles = history.length;
  const totalDepth = history.reduce((acc, r) => acc + (r.layers || []).reduce((s, l) => s + (l.lengthMeters || 0), 0), 0);
  const avgSpeed = history.length > 0
    ? history.reduce((acc, r) => acc + ((r.layers || []).reduce((s, l) => s + (l.speedMph || 0), 0) / (r.layers?.length || 1)), 0) / history.length
    : 0;

  // Tìm các cọc có vận tốc khoan < 1m/h (Bỏ qua 2 lớp cuối cùng)
  const slowPiles = history.filter(r => 
    (r.layers || []).slice(0, -2).some(l => l.speedMph > 0 && l.speedMph < 1)
  );

  // ── Phát hiện trùng lặp (Hạng mục + Số hiệu cọc) ──
  const normalizeKey = (str: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]/g, ""); // Viết liền, không dấu, không ký tự đặc biệt
  };

  interface DuplicateGroup {
    key: string;
    item: string;
    pileId: string;
    records: ExtractionResult[];
  }
  const duplicateMap: Record<string, ExtractionResult[]> = {};
  history.forEach(r => {
    const componentName = (r.componentName || '').trim();
    const pileId = (r.pileId || '').trim();
    if (!componentName && !pileId) return;
    
    // Tạo key chuẩn hóa để so sánh chính xác hơn
    const normComponent = normalizeKey(componentName);
    const normPile = normalizeKey(pileId);
    const key = `${normComponent}|||${normPile}`;
    
    if (!duplicateMap[key]) duplicateMap[key] = [];
    duplicateMap[key].push(r);
  });
  const duplicateGroups: DuplicateGroup[] = Object.entries(duplicateMap)
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => {
      const [componentName, pileId] = key.split('|||');
      return { key, item: componentName, pileId, records };
    })
    .sort((a, b) => b.records.length - a.records.length);

  // ── Phát hiện không nhất quán: cùng số TT địa chất, lớp thiết kế khác nhau ──
  interface InconsistentRecord {
    result: ExtractionResult;
    conflicts: { geology: string; designs: string[] }[];
  }
  const inconsistentRecords: InconsistentRecord[] = history
    .map(r => {
      const map: Record<string, Set<string>> = {};
      (r.layers || []).forEach(layer => {
        const geo = (layer.actualGeology || '').trim();
        const design = (layer.layerDesign || '').trim();
        if (!geo || !design) return;
        if (!map[geo]) map[geo] = new Set();
        map[geo].add(design);
      });
      const conflicts = Object.entries(map)
        .filter(([, d]) => d.size > 1)
        .map(([geology, d]) => ({ geology, designs: Array.from(d) }));
      return conflicts.length > 0 ? { result: r, conflicts } : null;
    })
    .filter(Boolean) as InconsistentRecord[];

  // ── Tính toán Thống kê theo lớp thiết kế (Tổng hợp từ tất cả biên bản) ──
  interface LayerStat {
    designLayerCode: string;
    layerDesign: string;
    diameter: string;
    pileIds: Set<string>;
    segments: number;
    minSpeed: number;
    maxSpeed: number;
    totalDuration: number;
    totalLength: number;
    colorIdx: number;
  }
  
  const statsMap: Record<string, LayerStat> = {};
  let colorCounter = 0;
  const colorMap: Record<string, number> = {};

  const normalizeForGrouping = (str: string) => {
    if (!str) return '';
    return str.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      // Loại bỏ các từ đệm phổ biến trong mô tả địa chất để gộp nhóm thông minh hơn
      .replace(/\b(mau|trang thai|ket cau|lop|lan|phan)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  };

  history.forEach(res => {
    (res.layers || []).forEach(layer => {
      const code = (layer.designLayerCode || '').trim();
      const design = (layer.layerDesign || 'Chưa xác định').trim();
      const dia = (res.diameter || '—').trim();
      
      const cleanCode = normalizeForGrouping(code);
      const cleanDesign = normalizeForGrouping(design);
      const cleanDia = normalizeForGrouping(dia);
      
      const key = `${cleanDesign}|||${cleanDia}`;
      
      if (!statsMap[key]) {
        const colorKey = design;
        if (colorMap[colorKey] === undefined) {
          colorMap[colorKey] = colorCounter % GROUP_COLORS.length;
          colorCounter++;
        }
        statsMap[key] = {
          designLayerCode: code,
          layerDesign: design,
          diameter: dia,
          pileIds: new Set(),
          segments: 0,
          minSpeed: Infinity,
          maxSpeed: -Infinity,
          totalDuration: 0,
          totalLength: 0,
          colorIdx: colorMap[colorKey]
        };
      }
      
      const stat = statsMap[key];
      stat.pileIds.add((res.pileId || res.id).trim());
      stat.segments += 1;
      stat.totalDuration += layer.durationHours;
      stat.totalLength += layer.lengthMeters;
      
      const spd = layer.speedMph;
      if (spd > 0) {
        if (spd < stat.minSpeed) stat.minSpeed = spd;
        if (spd > stat.maxSpeed) stat.maxSpeed = spd;
      }
    });
  });

  const designLayerStats = Object.values(statsMap).sort((a, b) => {
    // Sắp xếp: đường kính thấp→cao (số trong chuỗi D1000, D2000...), sau đó A→Z theo mô tả
    const diaA = parseInt((a.diameter || '').replace(/\D/g, '')) || 0;
    const diaB = parseInt((b.diameter || '').replace(/\D/g, '')) || 0;
    if (diaA !== diaB) return diaA - diaB;
    return (a.layerDesign || '').localeCompare(b.layerDesign || '', 'vi', { sensitivity: 'base' });
  });

  // allPileIds nên lấy từ history để đảm bảo đếm đủ số cọc đã upload
  const allPileIdsCount = history.length;
  
  let globalMinSpeed = Infinity;
  let globalMaxSpeed = -Infinity;
  designLayerStats.forEach(s => {
    if (s.minSpeed < globalMinSpeed) globalMinSpeed = s.minSpeed;
    if (s.maxSpeed > globalMaxSpeed) globalMaxSpeed = s.maxSpeed;
  });

  const totalSegments = designLayerStats.reduce((s, g) => s + g.segments, 0);

  // ── Bổ sung: Thống kê theo Cấp đất đá ──
  const soilStatsMap: Record<string, LayerStat> = {};
  history.forEach(res => {
    (res.layers || []).forEach(layer => {
      const scRaw = (layer.soilClass || '').trim();
      // Nếu soilClass không nằm trong danh sách chuẩn → về "Chưa Phân định nhóm"
      const sc = SOIL_CLASSES.includes(scRaw) ? scRaw : 'Chưa Phân định nhóm';
      const dia = (res.diameter || '—').trim();
      const key = `${sc}|||${dia}`;
      
      if (!soilStatsMap[key]) {
        soilStatsMap[key] = {
          designLayerCode: '',
          layerDesign: sc,
          diameter: dia,
          pileIds: new Set(),
          segments: 0,
          minSpeed: Infinity,
          maxSpeed: -Infinity,
          totalDuration: 0,
          totalLength: 0,
          colorIdx: Math.max(0, SOIL_CLASSES.indexOf(sc)) % GROUP_COLORS.length
        };
      }
      
      const stat = soilStatsMap[key];
      stat.pileIds.add((res.pileId || res.id).trim());
      stat.segments += 1;
      stat.totalDuration += layer.durationHours;
      stat.totalLength += layer.lengthMeters;
      
      const spd = layer.speedMph;
      if (spd > 0) {
        if (spd < stat.minSpeed) stat.minSpeed = spd;
        if (spd > stat.maxSpeed) stat.maxSpeed = spd;
      }
    });
  });

  const soilClassStats = Object.values(soilStatsMap).sort((a, b) => {
    const diaA = parseInt((a.diameter || '').replace(/\D/g, '')) || 0;
    const diaB = parseInt((b.diameter || '').replace(/\D/g, '')) || 0;
    if (diaA !== diaB) return diaA - diaB;
    return SOIL_CLASSES.indexOf(a.layerDesign) - SOIL_CLASSES.indexOf(b.layerDesign);
  });
  const totalDur = designLayerStats.reduce((s, g) => s + g.totalDuration, 0);
  const totalLen = designLayerStats.reduce((s, g) => s + g.totalLength, 0);
  const totalAvgSpd = totalDur > 0 ? totalLen / totalDur : 0;

  // ── Phát hiện biên bản thiếu dữ liệu ──
  interface MissingDataRecord {
    result: ExtractionResult;
    missing: { type: 'image' | 'excel' | 'supabase'; label: string }[];
  }
  const missingDataRecords: MissingDataRecord[] = history
    .map(r => {
      const missing: MissingDataRecord['missing'] = [];
      // Thiếu ảnh/PDF gốc
      if (!r.fileUrl && !r.fileName) {
        missing.push({ type: 'image', label: 'Ảnh / PDF gốc' });
      }
      // Thiếu file Excel trên GitHub
      if (!r.excelUrl) {
        missing.push({ type: 'excel', label: 'File Excel GitHub' });
      }
      // Thiếu dữ liệu địa chất (layers rỗng hoặc không có)
      if (!r.layers || r.layers.length === 0) {
        missing.push({ type: 'supabase', label: 'Dữ liệu địa chất (layers)' });
      }
      return missing.length > 0 ? { result: r, missing } : null;
    })
    .filter(Boolean) as MissingDataRecord[];

  // Badge màu cho từng loại thiếu
  const missingBadge = (type: 'image' | 'excel' | 'supabase') => {
    if (type === 'image')    return 'bg-purple-100 text-purple-700 border-purple-200';
    if (type === 'excel')    return 'bg-orange-100 text-orange-700 border-orange-200';
    if (type === 'supabase') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-slate-100 text-slate-600';
  };
  const missingIcon = (type: 'image' | 'excel' | 'supabase') => {
    if (type === 'image')    return '🖼️';
    if (type === 'excel')    return '📊';
    if (type === 'supabase') return '🗄️';
    return '❓';
  };


  // ── Weekly report data computation (ALL hooks MUST be before any early return) ──
  // Ngày ghi nhận biên bản = ngày kết thúc thi công (constructionEnd)
  const weeklyData = React.useMemo(() => {
    const map: Record<string, ExtractionResult[]> = {};
    history.forEach(r => {
      const dateStr = r.constructionEnd; // Thống nhất dùng ngày kết thúc
      const d = parseViDate(dateStr);
      if (!d) return;
      const key = getWeekKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [history]);

  const availableYears = React.useMemo(() => {
    const years = new Set<number>();
    // Luôn có năm hiện tại
    years.add(new Date().getFullYear());
    // Thêm các năm có dữ liệu
    Object.keys(weeklyData).forEach(k => {
      years.add(getWeekStartDate(k).getFullYear());
    });
    return Array.from(years).sort((a,b) => b - a);
  }, [weeklyData]);

  // Sinh tất cả các tuần (T6–T5) trong năm đang chọn — không phụ thuộc vào có dữ liệu hay không
  const weekKeys = React.useMemo(() => {
    const keys: string[] = [];
    // Tìm T6 đầu tiên của năm (hoặc T6 cuối năm trước nếu ngày 1/1 chưa đến T6)
    const jan1 = new Date(weeklyYear, 0, 1);
    // Lùi về T6 gần nhất trước hoặc đúng ngày 1/1
    const day = jan1.getDay();
    const daysSinceFri = (day + 2) % 7;
    const firstFri = new Date(weeklyYear, 0, 1 - daysSinceFri);
    // Sinh tuần cho đến hết năm
    const cur = new Date(firstFri);
    while (cur.getFullYear() <= weeklyYear) {
      const key = toLocalDateKey(cur);
      // Chỉ giữ tuần thuộc năm weeklyYear (T6 trong năm hoặc T5 trong năm)
      const thu5 = new Date(cur); thu5.setDate(thu5.getDate() + 6);
      if (cur.getFullYear() === weeklyYear || thu5.getFullYear() === weeklyYear) {
        keys.push(key);
      }
      cur.setDate(cur.getDate() + 7);
      if (cur.getFullYear() > weeklyYear + 1) break; // safety
    }
    return keys;
  }, [weeklyYear]);

  // Auto-select tuần hiện tại khi đổi năm hoặc load lần đầu
  React.useEffect(() => {
    if (weekKeys.length === 0) return;
    // Tìm tuần hiện tại
    const todayKey = getWeekKey(new Date());
    if (weekKeys.includes(todayKey)) {
      setSelectedWeekKey(todayKey);
    } else if (!selectedWeekKey || !weekKeys.includes(selectedWeekKey)) {
      // Nếu không có tuần hiện tại (năm khác), chọn tuần cuối có dữ liệu hoặc tuần cuối cùng
      const lastWithData = [...weekKeys].reverse().find(k => (weeklyData[k]||[]).length > 0);
      setSelectedWeekKey(lastWithData || weekKeys[weekKeys.length - 1]);
    }
  }, [weekKeys]);

  // Auto-select correct year based on available data (handles late-loading data)
  React.useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(weeklyYear)) {
      setWeeklyYear(availableYears[0]);
    }
  }, [availableYears]);

  // Sync year when defaultYear resolves from data
  React.useEffect(() => {
    if (defaultYear !== new Date().getFullYear()) {
      setWeeklyYear(defaultYear);
    }
  }, [defaultYear]);

  const selectedWeekRecords = selectedWeekKey ? (weeklyData[selectedWeekKey] || []) : [];

  // ── Biểu đồ cột: số cọc theo từng tuần, phân tách theo dự án ──
  const projectPilesByWeek = React.useMemo(() => {
    // Lấy tất cả tuần có dữ liệu (không lọc theo năm)
    const allWeekKeys = Object.keys(weeklyData).sort();
    if (allWeekKeys.length === 0) return { chartData: [], projectNames: [] };

    const allProjects = [...new Set(history.map(r => r.project).filter(Boolean))];

    const chartData = allWeekKeys.map(wk => {
      const recs = weeklyData[wk] || [];
      const entry: Record<string, string | number> = { week: `T${getWeekNumberFromKey(wk)}` };
      allProjects.forEach(proj => {
        entry[proj] = recs.filter(r => r.project === proj).length;
      });
      entry['_total'] = recs.length;
      entry['_weekKey'] = wk;
      return entry;
    });

    return { chartData, projectNames: allProjects };
  }, [weeklyData, history]);

  // Helper lấy số tuần từ weekKey
  function getWeekNumberFromKey(key: string): number {
    try {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const jan1 = new Date(date.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
      return Math.ceil((dayOfYear + jan1.getDay() + 1) / 7);
    } catch { return 0; }
  }

  // Per-project stats for selected week
  const weeklyProjectStats = React.useMemo(() => {
    const projs = [...new Set(selectedWeekRecords.map(r => r.project).filter(Boolean))];
    return projs.map(proj => {
      const recs = selectedWeekRecords.filter(r => r.project === proj);
      const totalPiles = recs.length;
      const totalDepth = recs.reduce((s, r) => s + (r.layers||[]).reduce((ls,l)=>ls+(l.lengthMeters||0),0), 0);
      const totalDuration = recs.reduce((s, r) => s + (r.layers||[]).reduce((ls,l)=>ls+(l.durationHours||0),0), 0);
      const avgSpeed = totalDuration > 0 ? totalDepth / totalDuration : 0;
      const diameters = [...new Set(recs.map(r=>r.diameter).filter(Boolean))].join(', ');
      const items = [...new Set(recs.map(r=>r.item||r.componentName).filter(Boolean))];
      return { proj, totalPiles, totalDepth, totalDuration, avgSpeed, diameters, items, recs };
    }).sort((a,b) => b.totalPiles - a.totalPiles);
  }, [selectedWeekRecords]);

  if (history.length === 0) return (
    <div className="flex flex-col items-center justify-center py-40 text-center animate-in fade-in duration-500">
      <div className="bg-slate-100 p-8 rounded-full mb-6"><BarChart3 className="text-slate-300 w-12 h-12" /></div>
      <h4 className="text-lg font-black text-slate-400 uppercase tracking-widest">Chưa có dữ liệu</h4>
      <p className="text-slate-400 mt-2 text-sm mb-8">Hãy upload biên bản để xem Dashboard</p>
      <button 
        onClick={onUploadClick}
        className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg shadow-orange-900/20 flex items-center gap-3"
      >
        <Upload size={18} />
        Tải lên ngay
      </button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">

      {/* ── Tiêu đề + Tabs ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
          <div>
            <h3 className="text-[18px] font-black text-black uppercase tracking-tight">Dashboard Tổng Hợp</h3>
            <p className="text-xs text-slate-500 font-medium">Tổng quan dữ liệu thi công cọc khoan nhồi</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setDashTab('overview')}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${dashTab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <span className="flex items-center gap-1.5"><BarChart3 size={12} /> Tổng quan</span>
            </button>
            <button
              onClick={() => setDashTab('weekly')}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${dashTab === 'weekly' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <span className="flex items-center gap-1.5"><Calendar size={12} /> Báo cáo tuần</span>
            </button>

          </div>
        </div>
      </div>

      {/* ── WEEKLY REPORT TAB ── */}
      {dashTab === 'weekly' && (
        <div className="space-y-5 animate-in fade-in duration-300">
          {/* Week selector header */}
          <div className="bg-gradient-to-br from-[#1a3a6b] to-[#1e4480] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-xl"><Calendar size={18} className="text-orange-300" /></div>
                <div>
                  <h4 className="text-[14px] font-black text-white uppercase tracking-wide">Báo Cáo Tuần</h4>
                  <p className="text-[10px] text-blue-200 font-medium mt-0.5">Chu kỳ Thứ 6 – Thứ 5 · So sánh các dự án · Ngày ghi nhận: Ngày kết thúc thi công</p>
                </div>
              </div>
              {/* Year + Week selectors — luôn hiển thị */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Năm:</span>
                  <select
                    value={weeklyYear}
                    onChange={e => { setWeeklyYear(+e.target.value); setSelectedWeekKey(''); }}
                    className="text-[12px] font-bold bg-white/15 border border-white/30 text-white rounded-lg px-3 py-2 focus:outline-none cursor-pointer"
                  >
                    {availableYears.map(y => <option key={y} value={y} className="text-slate-900 bg-white">{y}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">Tuần:</span>
                  <select
                    value={selectedWeekKey}
                    onChange={e => setSelectedWeekKey(e.target.value)}
                    disabled={weekKeys.length === 0}
                    className="text-[12px] font-bold bg-white/15 border border-white/30 text-white rounded-lg px-3 py-2 focus:outline-none cursor-pointer min-w-[240px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {weekKeys.length === 0
                      ? <option value="" className="text-slate-900 bg-white">— Không có dữ liệu năm {weeklyYear} —</option>
                      : weekKeys.map(key => {
                          const ws = getWeekStartDate(key);
                          const startOfYear = new Date(ws.getFullYear(), 0, 1);
                          const weekNo = Math.ceil(((ws.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
                          const we = new Date(ws); we.setDate(we.getDate() + 6);
                          const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
                          const recs = weeklyData[key] || [];
                          return (
                            <option key={key} value={key} className="text-slate-900 bg-white">
                              Tuần {weekNo} · T6 {fmt(ws)} – T5 {fmt(we)} · {recs.length} cọc
                            </option>
                          );
                        })
                    }
                  </select>
                </div>
              </div>
            </div>

            {/* Week pills — tất cả các tuần trong năm */}
            <div className="flex flex-wrap gap-2">
              {weekKeys.map((key) => {
                const recs = weeklyData[key] || [];
                const weekStart = getWeekStartDate(key);
                const startOfYear = new Date(weekStart.getFullYear(), 0, 1);
                const weekNo = Math.ceil(((weekStart.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
                const isSelected = key === selectedWeekKey;
                const hasData = recs.length > 0;
                const isCurrentWeek = key === getWeekKey(new Date());
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedWeekKey(key)}
                    className={`flex flex-col items-center px-3 py-2 rounded-xl border transition-all text-left
                      ${isSelected
                        ? 'bg-orange-500 border-orange-400 text-white shadow-lg shadow-orange-900/30 scale-105'
                        : hasData
                          ? 'bg-white/15 border-white/30 text-blue-100 hover:bg-white/25'
                          : 'bg-white/5 border-white/10 text-blue-300/60 hover:bg-white/10'
                      }`}
                  >
                    <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-1 ${isSelected ? 'text-orange-100' : isCurrentWeek ? 'text-yellow-300' : 'text-blue-300'}`}>
                      Tuần {weekNo}{isCurrentWeek && !isSelected ? ' ★' : ''}
                    </span>
                    <span className={`text-[10px] font-bold mt-0.5 ${isSelected ? 'text-white' : hasData ? 'text-blue-100' : 'text-blue-300/50'}`}>{getWeekLabel(weekStart)}</span>
                    <span className={`text-[9px] font-black mt-0.5 px-1.5 py-0.5 rounded-full
                      ${isSelected ? 'bg-orange-600 text-white' : hasData ? 'bg-white/20 text-blue-100' : 'bg-white/5 text-blue-300/40'}`}>
                      {hasData ? `${recs.length} cọc` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected week content — có dữ liệu */}
          {selectedWeekKey && selectedWeekRecords.length > 0 && (() => {
            const weekStart = getWeekStartDate(selectedWeekKey);
            const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23,59,59,999);
            const startOfYear = new Date(weekStart.getFullYear(), 0, 1);
            const weekNo = Math.ceil(((weekStart.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
            const totalWeekDepth = selectedWeekRecords.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.lengthMeters||0),0),0);
            const totalWeekDur = selectedWeekRecords.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.durationHours||0),0),0);
            const avgWeekSpeed = totalWeekDur > 0 ? totalWeekDepth / totalWeekDur : 0;
            const projectCount = [...new Set(selectedWeekRecords.map(r=>r.project).filter(Boolean))].length;

            // ── Lũy kế ──
            const prevRecords = history.filter(r => {
              const d = parseViDate(r.constructionEnd);
              return d && d.getTime() < weekStart.getTime();
            });
            const cumRecords = history.filter(r => {
              const d = parseViDate(r.constructionEnd);
              return d && d.getTime() <= weekEnd.getTime();
            });

            const calcStats = (recs: ExtractionResult[]) => ({
              piles: recs.length,
              depth: recs.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.lengthMeters||0),0),0),
              dur:   recs.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.durationHours||0),0),0),
            });
            const prevStats = calcStats(prevRecords);
            const cumStats  = calcStats(cumRecords);

            const thu5 = new Date(weekStart); thu5.setDate(thu5.getDate() + 6);
            const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

            return (
              <div className="space-y-5">
                {/* Header tuần */}
                <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-orange-500 rounded-full"/>
                    <h4 className="text-[13px] font-black text-slate-800 uppercase tracking-wide">
                      Tuần {weekNo} · {getWeekLabel(weekStart)}
                    </h4>
                    <span className="ml-2 text-[10px] font-bold text-slate-400">(Thứ 6 → Thứ 5)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2">
                      <Calendar size={13} className="text-blue-500 shrink-0"/>
                      <div className="text-[11px] font-bold text-blue-700">
                        <span className="text-blue-500">Thứ 6:</span> {fmtDate(weekStart)} &nbsp;→&nbsp; <span className="text-blue-500">Thứ 5:</span> {fmtDate(thu5)}
                      </div>
                    </div>
                    {/* Button xuất Excel */}
                    <button
                      onClick={async () => {
                        if (isExportingWeekly) return;
                        setIsExportingWeekly(true);
                        try {
                          const ExcelJS = await loadExcelJS();
                          const allProjsSorted = [...new Set(history.map((r: any) => r.project).filter(Boolean))]
                            .sort((a: any, b: any) => {
                              const pilesA = selectedWeekRecords.filter((r: any) => r.project === a).length;
                              const pilesB = selectedWeekRecords.filter((r: any) => r.project === b).length;
                              return pilesB - pilesA || a.localeCompare(b, 'vi');
                            }) as string[];

                          // ── Vẽ biểu đồ cột bằng canvas thuần → base64 PNG ──
                          const CHART_COLORS_EX = ['#3b82f6','#f97316','#10b981','#8b5cf6','#f59e0b','#06b6d4','#ef4444','#84cc16'];
                          const drawBarChartEx = (
                            chartData: { week: string; values: number[]; isSelected: boolean }[],
                            projNames: string[],
                            title: string
                          ): string => {
                            const scale = 2; // Tăng độ phân giải để ảnh nét hơn
                            const W = 1200 * scale, H = 260 * scale;
                            const PAD = { top: 20 * scale, right: 20 * scale, bottom: 30 * scale, left: 44 * scale };
                            const cW = W - PAD.left - PAD.right;
                            const cH = H - PAD.top - PAD.bottom;
                            const cv = document.createElement('canvas');
                            cv.width = W; cv.height = H;
                            const ctx = cv.getContext('2d')!;
                            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

                            const maxVal = Math.max(...chartData.map(d => d.values.reduce((s,v)=>s+v,0)), 5);
                            const gap = cW / chartData.length;
                            const barW = Math.min(40 * scale, gap * 0.6);

                            // Lưới ngang
                            for (let i = 0; i <= 5; i++) {
                              const y = PAD.top + cH - (i/5)*cH;
                              ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1 * scale;
                              ctx.beginPath(); ctx.moveTo(PAD.left,y); ctx.lineTo(PAD.left+cW,y); ctx.stroke();
                              ctx.fillStyle='#94a3b8'; ctx.font=`${10 * scale}px Arial`; ctx.textAlign='right';
                              ctx.fillText(String(Math.round((i/5)*maxVal)), PAD.left-6*scale, y+3*scale);
                            }

                            chartData.forEach((d, i) => {
                              const x = PAD.left + i*gap + gap/2 - barW/2;
                              const tot = d.values.reduce((s,v)=>s+v, 0);
                              
                              if (tot > 0) {
                                const bH = (tot/maxVal)*cH;
                                const y = PAD.top + cH - bH;
                                
                                // Màu sắc: Cam cho tuần hiện tại, Xanh lá cho các tuần khác
                                ctx.fillStyle = d.isSelected ? '#f97316' : '#10b981';
                                
                                // Vẽ cột với bo góc nhẹ
                                if (ctx.roundRect) {
                                  ctx.beginPath();
                                  ctx.roundRect(x, y, barW, bH, 4 * scale);
                                  ctx.fill();
                                } else {
                                  ctx.fillRect(x, y, barW, bH);
                                }
                                
                                // Hiển thị số lượng cọc trên đầu cột
                                ctx.fillStyle = '#1e293b'; 
                                ctx.font = `bold ${12 * scale}px Arial`; 
                                ctx.textAlign = 'center'; 
                                ctx.fillText(String(tot), x + barW/2, y - 6 * scale);
                              }
                              
                              // Tên tuần bên dưới
                              ctx.fillStyle = d.isSelected ? '#f97316' : '#64748b'; 
                              ctx.font = d.isSelected ? `bold ${10 * scale}px Arial` : `${9 * scale}px Arial`; 
                              ctx.textAlign = 'center';
                              ctx.fillText(d.week, x + barW/2, PAD.top + cH + 18 * scale);
                            });

                            return cv.toDataURL('image/png');
                          };

                          const buildChartRowsEx = (filterProj?: string) =>
                            weekKeys.map(wk => {
                              const [cy,cm,cd]=wk.split('-').map(Number);
                              const dt=new Date(cy,cm-1,cd); const jan1=new Date(dt.getFullYear(),0,1);
                              const wn=Math.ceil(((dt.getTime()-jan1.getTime())/86400000+jan1.getDay()+1)/7);
                              if(wn>52) return null;
                              const recs=weeklyData[wk]||[];
                              const values=filterProj
                                ?[recs.filter((r:any)=>r.project===filterProj).length]
                                :allProjsSorted.map((p:string)=>recs.filter((r:any)=>r.project===p).length);
                              return {week:`T${wn}`,values,isSelected:wk===selectedWeekKey};
                            }).filter(Boolean) as {week:string;values:number[];isSelected:boolean}[];

                          const imgAll = drawBarChartEx(buildChartRowsEx(), allProjsSorted, `So coc theo tung tuan - Tat ca du an - Nam ${weeklyYear}`);

                          const wb = new ExcelJS.Workbook();
                          wb.creator = 'SGC-CKN';
                          wb.created = new Date();

                          // ── Màu & style dùng chung ──
                          const NAVY  = 'FF1A3A6B';
                          const NAVY2 = 'FF1E4480';
                          const WHITE = 'FFFFFFFF';
                          const ORANGE_BG = 'FFFFF7ED';
                          const GREEN_BG  = 'FFF0FDF4';
                          const BLUE_BG   = 'FFEFF6FF';
                          const SLATE_BG  = 'FFF8FAFC';
                          const PROJ_COLORS = ['FFEFF6FF','FFFFF7ED','FFF0FDF4','FFF5F3FF','FFFEFCE8','FFF0FDFA','FFFEF2F2','FFF7FEE7'];
                          const navyFill  = (argb = NAVY) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
                          const solidFill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
                          const boldWhite = (sz = 11) => ({ bold: true, color: { argb: WHITE }, size: sz });
                          const boldDark  = (sz = 10) => ({ bold: true, color: { argb: 'FF1E293B' }, size: sz });
                          const thinBorder = { style: 'thin', color: { argb: 'FFE2E8F0' } };
                          const hairBorder = { style: 'hair', color: { argb: 'FFE2E8F0' } };
                          const center = { horizontal: 'center' as const, vertical: 'middle' as const };
                          const left   = { horizontal: 'left'   as const, vertical: 'middle' as const };

                          const setTitle = (sh: any, txt: string, cols: number, subTxt?: string) => {
                            sh.mergeCells(`A1:${String.fromCharCode(64+cols)}1`);
                            sh.getCell('A1').value = txt;
                            sh.getCell('A1').font = boldWhite(14);
                            sh.getCell('A1').fill = navyFill() as any;
                            sh.getCell('A1').alignment = { ...center, wrapText: false };
                            sh.getRow(1).height = 32;
                            if (subTxt) {
                              sh.mergeCells(`A2:${String.fromCharCode(64+cols)}2`);
                              sh.getCell('A2').value = subTxt;
                              sh.getCell('A2').font = boldWhite(10);
                              sh.getCell('A2').fill = solidFill('FF1E4480') as any; // Navy mid — khác với tiêu đề dự án
                              sh.getCell('A2').alignment = center;
                              sh.getRow(2).height = 20;
                            }
                          };

                          const addHeaderRow = (sh: any, cols: string[], fills = NAVY) => {
                            const r = sh.addRow(cols);
                            r.eachCell((c: any) => { c.fill = navyFill(fills) as any; c.font = boldWhite(10); c.alignment = { ...center, wrapText: true }; c.border = { bottom: thinBorder }; });
                            r.height = 26;
                            return r;
                          };

                          const fmtN = (v: number, d = 1) => Math.round(v * Math.pow(10,d)) / Math.pow(10,d);

                          // ══════════════════════════════════════════════
                          // SHEET 1: Tổng hợp tuần (giống card Tổng hợp tất cả dự án)
                          // ══════════════════════════════════════════════
                          const sh1 = wb.addWorksheet('Tổng hợp tuần');
                          sh1.views = [{ showGridLines: false, view: 'pageBreakPreview' }];
                          
                          setTitle(sh1, `BÁO CÁO TUẦN ${weekNo}  ·  ${fmtDate(weekStart)} → ${fmtDate(thu5)}`, 9, `Thứ 6: ${fmtDate(weekStart)}  →  Thứ 5: ${fmtDate(thu5)}  ·  ${allProjsSorted.length} dự án`);

                          // Tiêu đề tổng hợp tất cả dự án
                          {
                            const rTotalHeader = sh1.addRow(['TỔNG HỢP TẤT CẢ DỰ ÁN']);
                            sh1.mergeCells(`A${sh1.rowCount}:I${sh1.rowCount}`);
                            rTotalHeader.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
                            rTotalHeader.getCell(1).fill = solidFill('FF334155') as any;
                            rTotalHeader.getCell(1).alignment = center;
                            rTotalHeader.height = 24;
                          }

                          // Helper vẽ block Dashboard
                          const drawSummaryBlock = (sh: any, startCol: number, startRow: number, title: string, stats: any, bg: string, fg: string, accent: string) => {
                            const colLetter = (c: number) => String.fromCharCode(64 + c);
                            sh.mergeCells(`${colLetter(startCol)}${startRow}:${colLetter(startCol + 2)}${startRow}`);
                            const tCell = sh.getCell(`${colLetter(startCol)}${startRow}`);
                            tCell.value = title;
                            tCell.fill = solidFill(bg) as any;
                            tCell.font = { bold: true, color: { argb: fg }, size: 10 };
                            tCell.alignment = center;
                            tCell.border = { top: thinBorder, left: thinBorder, right: thinBorder, bottom: thinBorder };

                            sh.mergeCells(`${colLetter(startCol)}${startRow+1}:${colLetter(startCol + 2)}${startRow+2}`);
                            const pCell = sh.getCell(`${colLetter(startCol)}${startRow+1}`);
                            pCell.value = `${stats.piles} cọc`;
                            pCell.fill = solidFill(bg) as any;
                            pCell.font = { bold: true, color: { argb: accent }, size: 22 };
                            pCell.alignment = center;
                            pCell.border = { left: thinBorder, right: thinBorder, top: thinBorder, bottom: thinBorder };

                            const labels = ['Chiều sâu', 'Thời gian', 'Vận tốc TB'];
                            const values = [`${fmtN(stats.depth)} m`, `${fmtN(stats.dur, 1)} h`, stats.dur > 0 ? `${fmtN(stats.depth / stats.dur, 2)} m/h` : '—'];
                            labels.forEach((label, i) => {
                              const c = sh.getCell(`${colLetter(startCol + i)}${startRow+3}`);
                              c.value = label;
                              c.fill = solidFill('FFFFFFFF') as any;
                              c.font = { size: 8, color: { argb: 'FF64748B' } };
                              c.alignment = center;
                              c.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
                            });
                            values.forEach((val, i) => {
                              const c = sh.getCell(`${colLetter(startCol + i)}${startRow+4}`);
                              c.value = val;
                              c.fill = solidFill('FFFFFFFF') as any;
                              c.font = { bold: true, size: 10, color: { argb: accent } };
                              c.alignment = center;
                              c.border = { bottom: thinBorder, left: thinBorder, right: thinBorder, top: thinBorder };
                            });
                          };

                          const totalWeekStats = {
                            piles: selectedWeekRecords.length,
                            depth: selectedWeekRecords.reduce((s:number,r:any)=>s+(r.layers||[]).reduce((ls:number,l:any)=>ls+(l.lengthMeters||0),0),0),
                            dur:   selectedWeekRecords.reduce((s:number,r:any)=>s+(r.layers||[]).reduce((ls:number,l:any)=>ls+(l.durationHours||0),0),0),
                          };
                          const prevTotalStats = {
                            piles: history.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<weekStart.getTime();}).length,
                            depth: history.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<weekStart.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.lengthMeters||0),0),0),
                            dur:   history.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<weekStart.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.durationHours||0),0),0),
                          };
                          const cumTotalStats = {
                            piles: history.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<=weekEnd.getTime();}).length,
                            depth: history.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<=weekEnd.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.lengthMeters||0),0),0),
                            dur:   history.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<=weekEnd.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.durationHours||0),0),0),
                          };

                          {
                            const totalStartRow = sh1.rowCount + 1;
                            drawSummaryBlock(sh1, 1, totalStartRow, 'LŨY KẾ ĐẾN TUẦN TRƯỚC', prevTotalStats, 'FFDCFCE7', 'FF166534', 'FF15803D');
                            drawSummaryBlock(sh1, 4, totalStartRow, 'THỰC HIỆN TUẦN NÀY', totalWeekStats, ORANGE_BG.substring(2), 'FF9A3412', 'FFEA580C');
                            drawSummaryBlock(sh1, 7, totalStartRow, 'LŨY KẾ ĐẾN TUẦN NÀY', cumTotalStats, BLUE_BG.substring(2), 'FF1E40AF', 'FF2563EB');
                            sh1.getRow(totalStartRow).height = 20;
                            sh1.getRow(totalStartRow+1).height = 30;
                            sh1.getRow(totalStartRow+2).height = 30;
                            sh1.getRow(totalStartRow+3).height = 16;
                            sh1.getRow(totalStartRow+4).height = 22;
                          }

                          sh1.columns = [{width:18},{width:18},{width:18},{width:18},{width:18},{width:18},{width:18},{width:18},{width:18}];

                          // Helper nhúng ảnh biểu đồ — rộng bằng mép bảng col 0→9
                          // anchorRow: row index (0-based) nơi ảnh bắt đầu
                          const embedChart = (sh: any, base64img: string, anchorRow: number) => {
                            const NUM_ROWS = 18;
                            const ROW_H_PT = 20;
                            const iid = wb.addImage({ base64: base64img.replace(/^data:image\/png;base64,/, ''), extension: 'png' });
                            sh.addImage(iid, {
                              tl: { col: 0, row: anchorRow },
                              br: { col: 9, row: anchorRow + NUM_ROWS }
                            });
                            // Advance rowCount đến sau ảnh
                            while (sh.rowCount < anchorRow + NUM_ROWS) {
                              const r = sh.addRow([]);
                              r.height = ROW_H_PT;
                            }
                          };

                          // Nhúng ảnh biểu đồ tổng hợp — bắt đầu ngay sau block 5 dòng (totalStartRow+5-1 = index 0-based)
                          embedChart(sh1, imgAll, sh1.rowCount + 5);

                          // ══════════════════════════════════════════════
                          // CHI TIẾT TỪNG DỰ ÁN
                          // ══════════════════════════════════════════════
                          allProjsSorted.forEach((projName) => {
                            const rHeader = sh1.addRow([`DỰ ÁN: ${projName.toUpperCase()}`]);
                            sh1.mergeCells(`A${sh1.rowCount}:I${sh1.rowCount}`);
                            rHeader.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
                            rHeader.getCell(1).fill = solidFill('FF334155') as any; // Slate 700
                            rHeader.getCell(1).alignment = center;
                            rHeader.height = 24;

                            const projWeekRecords = selectedWeekRecords.filter((r: any) => r.project === projName);
                            const projHistory = history.filter((r: any) => r.project === projName);

                            const projWeekStats = {
                              piles: projWeekRecords.length,
                              depth: projWeekRecords.reduce((s:number,r:any)=>s+(r.layers||[]).reduce((ls:number,l:any)=>ls+(l.lengthMeters||0),0),0),
                              dur:   projWeekRecords.reduce((s:number,r:any)=>s+(r.layers||[]).reduce((ls:number,l:any)=>ls+(l.durationHours||0),0),0),
                            };
                            const projPrevStats = {
                              piles: projHistory.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<weekStart.getTime();}).length,
                              depth: projHistory.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<weekStart.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.lengthMeters||0),0),0),
                              dur:   projHistory.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<weekStart.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.durationHours||0),0),0),
                            };
                            const projCumStats = {
                              piles: projHistory.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<=weekEnd.getTime();}).length,
                              depth: projHistory.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<=weekEnd.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.lengthMeters||0),0),0),
                              dur:   projHistory.filter((r: any)=>{const d=parseViDate(r.constructionEnd);return d&&d.getTime()<=weekEnd.getTime();}).reduce((s: number,r: any)=>s+(r.layers||[]).reduce((ls: number,l: any)=>ls+(l.durationHours||0),0),0),
                            };

                            const startRow = sh1.rowCount + 1;
                            drawSummaryBlock(sh1, 1, startRow, 'LŨY KẾ ĐẾN TUẦN TRƯỚC', projPrevStats, 'FFDCFCE7', 'FF166534', 'FF15803D');
                            drawSummaryBlock(sh1, 4, startRow, 'THỰC HIỆN TUẦN NÀY', projWeekStats, ORANGE_BG.substring(2), 'FF9A3412', 'FFEA580C');
                            drawSummaryBlock(sh1, 7, startRow, 'LŨY KẾ ĐẾN TUẦN NÀY', projCumStats, BLUE_BG.substring(2), 'FF1E40AF', 'FF2563EB');

                            sh1.getRow(startRow).height = 20; sh1.getRow(startRow+1).height = 30; sh1.getRow(startRow+2).height = 30; sh1.getRow(startRow+3).height = 16; sh1.getRow(startRow+4).height = 22;

                            // Thêm biểu đồ cho từng dự án
                            const projImg = drawBarChartEx(buildChartRowsEx(projName), [projName], `So coc theo tung tuan - Du an: ${projName} - Nam ${weeklyYear}`);
                            embedChart(sh1, projImg, startRow + 4);
                          });

                          // Define print area to only show data area dynamically
                          sh1.pageSetup.printArea = `A1:I${sh1.rowCount}`;

                          // ══════════════════════════════════════════════
                          // SHEET 2: Dữ liệu thi công (toàn bộ cọc trong tuần)
                          // ══════════════════════════════════════════════
                          const wsDTC = wb.addWorksheet('Dữ liệu thi công');
                          wsDTC.views = [{ showGridLines: true }];
                          wsDTC.columns = [
                            { width: 6 }, { width: 28 }, { width: 22 }, { width: 22 }, { width: 10 },
                            { width: 14 }, { width: 10 }, { width: 18 }, { width: 18 }, { width: 12 },
                            { width: 12 }, { width: 14 }, { width: 18 },
                          ];
                          {
                            const titleRow = wsDTC.addRow(['BẢNG TỔNG HỢP DỮ LIỆU THI CÔNG']);
                            titleRow.height = 30;
                            wsDTC.mergeCells(1, 1, 1, 13);
                            const tc = titleRow.getCell(1);
                            tc.value = 'BẢNG TỔNG HỢP DỮ LIỆU THI CÔNG';
                            tc.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
                            tc.fill = solidFill('FF1E3A6E') as any;
                            tc.alignment = center;

                            const HDRS = ['STT','Dự án','Hạng mục','Tên bộ phận','Số hiệu','Tên Máy khoan','Đường kính','Bắt đầu','Kết thúc','Chiều dài (m)','T.Gian TC (h)','Vận tốc TB (m/h)','Sheet ảnh'];
                            const hdrRow = wsDTC.addRow(HDRS);
                            hdrRow.height = 25;
                            hdrRow.eachCell((c: any, ci: number) => {
                              c.fill = solidFill('FF1E3A6E') as any;
                              c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
                              c.alignment = { ...center, wrapText: true };
                              c.border = { bottom: thinBorder, right: thinBorder };
                            });
                            wsDTC.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 13 } };

                            // Sắp xếp theo ngày kết thúc giảm dần (mới nhất lên trên)
                            const sortedRecs = [...selectedWeekRecords].sort((a: any, b: any) => {
                              const da = parseViDate(a.constructionEnd), db = parseViDate(b.constructionEnd);
                              return (db?.getTime() || 0) - (da?.getTime() || 0);
                            });
                            sortedRecs.forEach((res: any, idx: number) => {
                              const stt = idx + 1;
                              const totalLen = (res.layers || []).reduce((s: number, l: any) => s + (l.lengthMeters || 0), 0);
                              const totalDur = (res.layers || []).reduce((s: number, l: any) => s + (l.durationHours || 0), 0);
                              const avgSpeed = totalDur > 0 ? totalLen / totalDur : 0;
                              const rawName = `BB${stt}_${(res.pileId || '').replace(/[^\w]/g, '').slice(0, 10)}`;
                              const sheetName = rawName.slice(0, 31);
                              const row = wsDTC.addRow([
                                stt, res.project, res.item, res.componentName, res.pileId,
                                res.reportNumber, res.diameter, res.constructionStart, res.constructionEnd,
                                parseFloat(totalLen.toFixed(2)), parseFloat(totalDur.toFixed(2)), parseFloat(avgSpeed.toFixed(2)),
                                { text: `→ ${sheetName}`, hyperlink: `#'${sheetName}'!A1` }
                              ]);
                              row.height = 18;
                              row.eachCell((c: any, ci: number) => {
                                const isText = [2,3,4,6].includes(ci);
                                const isLink = ci === 13;
                                c.font = { size: 9, color: { argb: isLink ? 'FF2563EB' : 'FF1E293B' }, bold: isLink, underline: isLink };
                                c.alignment = { vertical: 'middle', horizontal: isText ? 'left' : 'center', wrapText: isText };
                                c.fill = solidFill(idx % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF') as any;
                                c.border = { bottom: thinBorder, right: thinBorder };
                              });
                            });
                          }

                          // ══════════════════════════════════════════════
                          // SHEET 3+: Chi tiết từng biên bản trong tuần
                          // Format giống hệt file xuất Excel tổng
                          // ══════════════════════════════════════════════
                          {
                            // Helpers dùng chung với file xuất tổng
                            const argbW = (hex: string) => 'FF' + hex.toUpperCase();
                            const thinBW = (color = 'CBD5E1') => ({
                              top: { style: 'thin' as const, color: { argb: argbW(color) } },
                              bottom: { style: 'thin' as const, color: { argb: argbW(color) } },
                              left: { style: 'thin' as const, color: { argb: argbW(color) } },
                              right: { style: 'thin' as const, color: { argb: argbW(color) } },
                            });
                            const applyCell = (cell: any, val: any, opts: { bg?: string; fontColor?: string; bold?: boolean; sz?: number; align?: string; wrap?: boolean }) => {
                              cell.value = val;
                              cell.font = { name: 'Arial', size: opts.sz ?? 10, bold: opts.bold ?? false, color: { argb: argbW(opts.fontColor ?? '000000') } };
                              if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbW(opts.bg) } };
                              cell.alignment = { horizontal: (opts.align ?? 'center') as any, vertical: 'middle', wrapText: opts.wrap ?? false };
                              cell.border = thinBW();
                            };

                            // Sắp xếp theo thứ tự dự án (số cọc giảm dần) rồi ngày kết thúc
                            const projOrder = allProjsSorted;
                            const sortedRecs = [...selectedWeekRecords].sort((a: any, b: any) => {
                              const pi = projOrder.indexOf(a.project) - projOrder.indexOf(b.project);
                              if (pi !== 0) return pi;
                              const da = parseViDate(a.constructionEnd), db = parseViDate(b.constructionEnd);
                              return (db?.getTime() || 0) - (da?.getTime() || 0);
                            });

                            // Fetch ảnh song song — dùng proxy với fileUrl (giống cách file xuất tổng)
                            const fetchImgWeekly = async (res: any): Promise<{ base64: string; ext: string } | null> => {
                              try {
                                // Ưu tiên _base64 nếu có trong bộ nhớ tạm
                                if (res._base64) {
                                  const parts = res._base64.split(',');
                                  if (parts.length > 1) {
                                    const mime = res._mimeType || '';
                                    const ext = mime.includes('png') ? 'png' : 'jpeg';
                                    return { base64: parts[1], ext };
                                  }
                                }
                                // Lấy từ fileUrl qua proxy
                                let url = res.fileUrl;
                                if (!url) return null;
                                if (url.includes('github.com') && url.includes('/blob/')) {
                                  url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                                }
                                const proxyResp = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
                                if (proxyResp.ok) {
                                  const buf = await proxyResp.arrayBuffer();
                                  if (buf.byteLength > 100) {
                                    const blob2 = new Blob([buf]);
                                    const base64 = await new Promise<string>((resolve) => {
                                      const reader = new FileReader();
                                      reader.onload = () => resolve((reader.result as string).split(',')[1]);
                                      reader.readAsDataURL(blob2);
                                    });
                                    const ext = blob2.type.includes('png') ? 'png' : 'jpeg';
                                    return { base64, ext };
                                  }
                                }
                                // Fallback: fetch trực tiếp với GitHub token
                                if (githubCreds?.token) {
                                  const resp = await fetch(url, {
                                    headers: { 'Authorization': `token ${githubCreds.token}` },
                                    cache: 'no-store'
                                  });
                                  if (resp.ok) {
                                    const buf = await resp.arrayBuffer();
                                    if (buf.byteLength > 100) {
                                      const blob2 = new Blob([buf]);
                                      const base64 = await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onload = () => resolve((reader.result as string).split(',')[1]);
                                        reader.readAsDataURL(blob2);
                                      });
                                      const ext = blob2.type.includes('png') ? 'png' : 'jpeg';
                                      return { base64, ext };
                                    }
                                  }
                                }
                                return null;
                              } catch { return null; }
                            };

                            const CHUNK_W = 5;
                            const imgResults: ({ base64: string; ext: string } | null)[] = new Array(sortedRecs.length).fill(null);
                            for (let ci = 0; ci < sortedRecs.length; ci += CHUNK_W) {
                              const chunk = sortedRecs.slice(ci, ci + CHUNK_W);
                              const fetched = await Promise.all(chunk.map((res: any) => fetchImgWeekly(res)));
                              fetched.forEach((img, j) => { imgResults[ci + j] = img; });
                            }

                            sortedRecs.forEach((res: any, idx: number) => {
                              const stt = idx + 1;
                              const rawName = `BB${stt}_${(res.pileId || '').replace(/[^\w]/g, '').slice(0, 10)}`;
                              const sheetName = rawName.slice(0, 31);
                              const wsB = wb.addWorksheet(sheetName);
                              wsB.views = [{ showGridLines: false }];
                              wsB.columns = [
                                { width: 14 }, { width: 11 }, { width: 46 }, { width: 13 }, { width: 13 },
                                { width: 11 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 28 },
                              ];

                              // Nút quay lại
                              const backRow = wsB.addRow([]);
                              backRow.height = 24;
                              const backCell = backRow.getCell(1);
                              backCell.value = { text: '← Quay lại Dữ liệu thi công', hyperlink: `#'Dữ liệu thi công'!A1` };
                              backCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' }, underline: false };
                              backCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A6B' } };
                              backCell.alignment = { horizontal: 'center', vertical: 'middle' };
                              backCell.border = thinBW();
                              wsB.mergeCells(backRow.number, 1, backRow.number, 11);
                              const blankBack = wsB.addRow([]); blankBack.height = 6;

                              // Thông tin biên bản
                              const infoItems: [string, any][] = [
                                ['Dự án', res.project], ['Hạng mục', res.item],
                                ['Tên bộ phận', res.componentName], ['Số hiệu cọc', res.pileId],
                                ['Tên Máy khoan', res.reportNumber], ['Đường kính', res.diameter],
                                ['Bắt đầu thi công', res.constructionStart], ['Kết thúc thi công', res.constructionEnd],
                              ];
                              infoItems.forEach(([k, v]) => {
                                const row = wsB.addRow([k, v]);
                                row.height = 18;
                                applyCell(row.getCell(1), k, { bg: 'EFF6FF', fontColor: '1E3A6E', bold: true, align: 'left' });
                                applyCell(row.getCell(2), v, { bg: 'FFFFFF', fontColor: '374151', align: 'left' });
                                wsB.mergeCells(row.number, 2, row.number, 11);
                              });
                              const blankR = wsB.addRow([]); blankR.height = 6;

                              // Header bảng lớp địa chất
                              const hdrCols = ['Địa chất TT', 'Đường kính', 'Mô tả lớp thiết kế', 'Từ (h)', 'Đến (h)', 'Cao độ từ', 'Cao độ đến', 'T.Gian (h)', 'Dài (m)', 'V (m/h)', 'Ghi chú'];
                              const hdrRow = wsB.addRow(hdrCols);
                              hdrRow.height = 36;
                              hdrCols.forEach((h, ci) => {
                                applyCell(hdrRow.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 || ci === 10 ? 'left' : 'center', wrap: true });
                              });

                              // Dữ liệu lớp địa chất — tô màu theo nhóm lớp (GROUP_COLORS)
                              let gc = 0; let pk = '';
                              const rowColorIdx = (res.layers || []).map((layer: any) => {
                                const key = layer.layerDesign?.trim() || '__';
                                if (key !== pk) { gc++; pk = key; }
                                return Math.max(0, gc - 1) % GROUP_COLORS.length;
                              });
                              (res.layers || []).forEach((layer: any, ri: number) => {
                                const { bg, font: fontColor } = GROUP_COLORS[rowColorIdx[ri]];
                                const spd = layer.speedMph ?? (layer.durationHours > 0 ? layer.lengthMeters / layer.durationHours : 0);
                                const isSlowSpd = spd > 0 && spd <= 1;
                                const spdBg = isSlowSpd ? 'DC2626' : spd > 5 ? 'D1FAE5' : 'FFF7ED';
                                const spdFontColor = isSlowSpd ? 'FFFFFF' : 'C2410C';
                                const vals = [
                                  getGeoDisplay(layer), res.diameter, layer.layerDesign,
                                  layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
                                  layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
                                  layer.elevationFrom, layer.elevationTo,
                                  parseFloat((layer.durationHours || 0).toFixed(2)),
                                  parseFloat((layer.lengthMeters || 0).toFixed(2)),
                                  parseFloat(spd.toFixed(2)),
                                  layer.notes || '',
                                ];
                                const dataRow = wsB.addRow(vals);
                                dataRow.height = 36;
                                vals.forEach((v, ci) => {
                                  const isSpd = ci === 9;
                                  const c = dataRow.getCell(ci + 1);
                                  c.value = v;
                                  c.font = { name: 'Arial', size: 10, bold: isSpd && isSlowSpd, color: { argb: argbW(isSpd ? spdFontColor : fontColor) } };
                                  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbW(isSpd ? spdBg : bg) } };
                                  c.alignment = { horizontal: (ci === 2 || ci === 10 ? 'left' : 'center') as any, vertical: 'middle', wrapText: ci === 2 || ci === 3 || ci === 4 || ci === 10 };
                                  c.border = thinBW();
                                });
                              });

                              // Nhúng ảnh biên bản gốc
                              const imgData = imgResults[idx];
                              const imgStartRow = wsB.rowCount + 2;
                              if (imgData) {
                                try {
                                  const imgId = wb.addImage({ base64: imgData.base64, extension: imgData.ext as any });
                                  const titleRow = wsB.getRow(imgStartRow);
                                  titleRow.height = 25;
                                  applyCell(titleRow.getCell(1), 'ẢNH BIÊN BẢN GỐC', { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 12, align: 'center' });
                                  wsB.mergeCells(imgStartRow, 1, imgStartRow, 11);
                                  wsB.addImage(imgId, { tl: { col: 0, row: imgStartRow }, ext: { width: 850, height: 1100 } });
                                  for (let i = imgStartRow + 1; i <= imgStartRow + 60; i++) wsB.getRow(i).height = 20;
                                } catch (e) { console.error('Lỗi nhúng ảnh BB tuần:', e); }
                              } else {
                                const titleRow = wsB.getRow(imgStartRow);
                                titleRow.height = 25;
                                applyCell(titleRow.getCell(1), '⚠️ THIẾU HÌNH ẢNH BIÊN BẢN GỐC', { bg: 'FEE2E2', fontColor: '991B1B', bold: true, sz: 12, align: 'center' });
                                wsB.mergeCells(imgStartRow, 1, imgStartRow, 11);
                              }
                            });
                          }

                          // ══════════════════════════════════════════════
                          // SHEET: Cảnh báo vận tốc khoan thấp < 1 m/h (Bỏ qua 2 lớp cuối)
                          // ══════════════════════════════════════════════
                          {
                            const slowInWeek = selectedWeekRecords.filter((r: any) =>
                              (r.layers || []).slice(0, -2).some((l: any) => l.speedMph > 0 && l.speedMph < 1)
                            );

                            const wsCB = wb.addWorksheet('Cảnh báo vận tốc');
                            wsCB.views = [{ showGridLines: false }];
                            wsCB.columns = [
                              { width: 6 }, { width: 28 }, { width: 22 }, { width: 12 },
                              { width: 20 }, { width: 50 }, { width: 14 },
                            ];

                            // Tiêu đề
                            const cbTitle = wsCB.addRow([`⚠ CẢNH BÁO VẬN TỐC KHOAN THẤP < 1 M/H — TUẦN ${weekNo}`]);
                            cbTitle.height = 30;
                            wsCB.mergeCells(1, 1, 1, 7);
                            const ct = cbTitle.getCell(1);
                            ct.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 13 };
                            ct.fill = solidFill('FFDC2626') as any;
                            ct.alignment = center;

                            const cbSub = wsCB.addRow([`Các cọc dưới đây có ít nhất 1 đoạn khoan với vận tốc < 1 m/h trong tuần này  ·  ${slowInWeek.length} cọc`]);
                            cbSub.height = 20;
                            wsCB.mergeCells(2, 1, 2, 7);
                            cbSub.getCell(1).font = { size: 9, color: { argb: 'FF7F1D1D' } };
                            cbSub.getCell(1).fill = solidFill('FFFEE2E2') as any;
                            cbSub.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

                            // Header
                            const HDRS_CB = ['#', 'Dự án', 'Số hiệu cọc', 'Đường kính', 'Ngày kết thúc', 'Đoạn chậm (Lớp — Vận tốc — Mô tả)', 'Tốc độ thấp nhất'];
                            const hdrCB = wsCB.addRow(HDRS_CB);
                            hdrCB.height = 24;
                            hdrCB.eachCell((c: any, ci: number) => {
                              c.fill = solidFill('FFDC2626') as any;
                              c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
                              c.alignment = { ...center, wrapText: true };
                              c.border = { bottom: thinBorder, right: thinBorder };
                            });

                            if (slowInWeek.length === 0) {
                              const noRow = wsCB.addRow(['', '✅ Không có cọc nào có vận tốc khoan thấp trong tuần này']);
                              wsCB.mergeCells(noRow.number, 2, noRow.number, 7);
                              noRow.getCell(2).font = { size: 10, color: { argb: 'FF166534' }, bold: true };
                              noRow.getCell(2).fill = solidFill('FFF0FDF4') as any;
                              noRow.height = 22;
                            } else {
                              slowInWeek.forEach((r: any, si: number) => {
                                const slowLayers = (r.layers || []).slice(0, -2).filter((l: any) => l.speedMph > 0 && l.speedMph < 1);
                                const minSpd = Math.min(...slowLayers.map((l: any) => l.speedMph));
                                const slowDesc = slowLayers.map((l: any) =>
                                  `Lớp ${l.layerNumber}: ${toNum(l.speedMph).toFixed(2)} m/h${l.layerDesign ? ' — ' + l.layerDesign : ''}`
                                ).join('\n');
                                const rowBg = si % 2 === 0 ? 'FFFFFFFF' : 'FFFFF1F1';
                                const dataRow = wsCB.addRow([
                                  si + 1, r.project, r.pileId || '—', r.diameter || '—',
                                  r.constructionEnd || '—', slowDesc,
                                  parseFloat(minSpd.toFixed(2)),
                                ]);
                                dataRow.height = Math.max(20, slowLayers.length * 18);
                                dataRow.eachCell((c: any, ci: number) => {
                                  c.fill = solidFill(ci === 7 ? 'FFFEE2E2' : rowBg) as any;
                                  c.font = {
                                    size: ci === 3 ? 10 : 9,
                                    bold: ci === 3 || ci === 7,
                                    color: { argb: ci === 3 ? 'FFB91C1C' : ci === 7 ? 'FFDC2626' : 'FF1E293B' }
                                  };
                                  c.alignment = { vertical: 'middle', horizontal: ci === 2 || ci === 6 ? 'left' : 'center', wrapText: ci === 6 };
                                  c.border = { bottom: thinBorder, right: thinBorder };
                                });
                              });

                              // Dòng tổng kết
                              const totalSlowLayers = slowInWeek.reduce((s: number, r: any) =>
                                s + (r.layers || []).slice(0, -2).filter((l: any) => l.speedMph > 0 && l.speedMph < 1).length, 0);
                              const allSpeeds = slowInWeek.flatMap((r: any) =>
                                (r.layers || []).slice(0, -2).filter((l: any) => l.speedMph > 0 && l.speedMph < 1).map((l: any) => l.speedMph));
                              const minAll = allSpeeds.length > 0 ? Math.min(...allSpeeds).toFixed(2) : '—';

                              const sumRow = wsCB.addRow([
                                '', `Tổng kết tuần ${weekNo}: ${slowInWeek.length}/${selectedWeekRecords.length} cọc có đoạn chậm · ${totalSlowLayers} đoạn < 1 m/h`,
                                '', '', '', '', `Thấp nhất: ${minAll} m/h`
                              ]);
                              sumRow.height = 22;
                              wsCB.mergeCells(sumRow.number, 2, sumRow.number, 5);
                              sumRow.eachCell((c: any) => {
                                c.fill = solidFill('FFFECACA') as any;
                                c.font = { bold: true, size: 9, color: { argb: 'FF7F1D1D' } };
                                c.alignment = { horizontal: 'left', vertical: 'middle' };
                                c.border = { top: { style: 'medium' as const, color: { argb: 'FFDC2626' } } };
                              });
                            }
                          }

                          // ── Xuất file ──
                          const buffer = await wb.xlsx.writeBuffer();
                          const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `SGC-CKN_BaoCaoTuan${weekNo}_${weeklyYear}.xlsx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          console.error(err);
                          alert('Xuất Excel thất bại!');
                        } finally {
                          setIsExportingWeekly(false);
                        }
                      }}
                      disabled={isExportingWeekly}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95 disabled:opacity-60"
                      style={{background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff'}}
                    >
                      {isExportingWeekly
                        ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"/><span>Đang xuất...</span></>
                        : <><FileDown size={14}/><span>Xuất báo cáo Excel</span></>
                      }
                    </button>
                  </div>
                </div>

                {/* ── Bảng lũy kế tiến độ — từng dự án A-Z ── */}
                {(() => {
                  const allProjs = [...new Set(history.map(r => r.project).filter(Boolean))]
                    .sort((a, b) => {
                      const pilesA = selectedWeekRecords.filter(r => r.project === a).length;
                      const pilesB = selectedWeekRecords.filter(r => r.project === b).length;
                      return pilesB - pilesA || a.localeCompare(b, 'vi');
                    });

                  // Tổng hợp tất cả dự án
                  const totalPrev = calcStats(history.filter(r => { const d = parseViDate(r.constructionEnd); return d && d.getTime() < weekStart.getTime(); }));
                  const totalWeek = {
                    piles: selectedWeekRecords.length,
                    depth: selectedWeekRecords.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.lengthMeters||0),0),0),
                    dur:   selectedWeekRecords.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.durationHours||0),0),0),
                  };
                  const totalCum  = calcStats(history.filter(r => { const d = parseViDate(r.constructionEnd); return d && d.getTime() <= weekEnd.getTime(); }));
                  const totalSpeedWeek = totalWeek.dur > 0 ? totalWeek.depth / totalWeek.dur : 0;
                  const totalPct = totalCum.piles > 0 ? Math.min(100, (totalWeek.piles / totalCum.piles) * 100) : 0;

                  return (
                    <div className="space-y-4">
                      {/* Tiêu đề chung */}
                      <div className="flex items-center gap-2 px-5 py-3 rounded-2xl" style={{background:'linear-gradient(135deg,#1a3a6b 0%,#1e4480 100%)'}}>
                        <TrendingUp size={15} className="text-orange-300"/>
                        <h5 className="text-[11px] font-black text-white uppercase tracking-widest">Thống kê lũy kế tiến độ</h5>
                        <span className="ml-auto text-[9px] font-bold text-blue-200 uppercase tracking-widest">Từng dự án · Tuần {weekNo}</span>
                      </div>

                      {/* ── Card tổng hợp tất cả dự án ── */}
                      <div className="bg-white border-2 border-slate-700 rounded-2xl overflow-hidden shadow-lg">
                        {/* Header */}
                        <div className="px-5 py-2.5 flex items-center gap-3" style={{background:'linear-gradient(135deg,#1a3a6b 0%,#1e4480 100%)'}}>
                          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                            <Building2 size={14} className="text-white"/>
                          </div>
                          <p className="text-[12px] font-black text-white flex-1">Tổng hợp tất cả dự án</p>
                          <span className="text-[10px] font-black text-white bg-white/20 px-3 py-0.5 rounded-full shrink-0">{allProjs.length} dự án · Tuần {weekNo}</span>
                        </div>

                        {/* 3 cột */}
                        <div className="grid grid-cols-3 divide-x divide-slate-200">
                          {/* Lũy kế đến tuần trước */}
                          <div className="p-4 bg-emerald-50">
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500"/>
                              <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Lũy kế đến tuần trước</p>
                            </div>
                            <div className="flex items-baseline gap-1 mb-2">
                              <span className="text-[22px] font-black text-emerald-700">{totalPrev.piles}</span>
                              <span className="text-[10px] font-bold text-emerald-400">cọc</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <div className="bg-white border border-emerald-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-emerald-500 uppercase mb-0.5">Chiều sâu</p>
                                <span className="text-[12px] font-black text-emerald-700">{formatNumber(totalPrev.depth,1)}</span>
                                <span className="text-[8px] font-bold text-emerald-400 ml-1">m</span>
                              </div>
                              <div className="bg-white border border-emerald-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-emerald-500 uppercase mb-0.5">Thời gian</p>
                                <span className="text-[12px] font-black text-emerald-700">{formatNumber(totalPrev.dur,1)}</span>
                                <span className="text-[8px] font-bold text-emerald-400 ml-1">h</span>
                              </div>
                              <div className="bg-white border border-emerald-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-emerald-500 uppercase mb-0.5">Vận tốc TB</p>
                                {(() => { const s = totalPrev.dur > 0 ? totalPrev.depth/totalPrev.dur : 0; return <><span className={`text-[12px] font-black ${s>=1?'text-emerald-700':s>0?'text-amber-600':'text-slate-400'}`}>{s>0?formatNumber(s,2):'—'}</span>{s>0&&<span className="text-[8px] font-bold text-emerald-400 ml-1">m/h</span>}</>; })()}
                              </div>
                            </div>
                          </div>

                          {/* Thực hiện tuần này */}
                          <div className="p-4 bg-orange-50 relative">
                            {totalWeek.piles > 0 && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-orange-500 animate-pulse"/>}
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="w-2 h-2 rounded-full bg-orange-500"/>
                              <p className="text-[9px] font-black text-orange-700 uppercase tracking-widest">Thực hiện tuần này</p>
                            </div>
                            <div className="flex items-baseline gap-1 mb-2">
                              <span className={`text-[22px] font-black ${totalWeek.piles > 0 ? 'text-orange-600' : 'text-slate-400'}`}>{totalWeek.piles}</span>
                              <span className="text-[10px] font-bold text-orange-400">cọc</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <div className="bg-white border border-orange-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-orange-400 uppercase mb-0.5">Chiều sâu</p>
                                <span className="text-[12px] font-black text-orange-600">{formatNumber(totalWeek.depth,1)}</span>
                                <span className="text-[8px] font-bold text-orange-400 ml-1">m</span>
                              </div>
                              <div className="bg-white border border-orange-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-orange-400 uppercase mb-0.5">Thời gian</p>
                                <span className="text-[12px] font-black text-orange-600">{formatNumber(totalWeek.dur,1)}</span>
                                <span className="text-[8px] font-bold text-orange-400 ml-1">h</span>
                              </div>
                              <div className="bg-white border border-orange-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-orange-400 uppercase mb-0.5">Vận tốc TB</p>
                                <span className={`text-[12px] font-black ${totalSpeedWeek>=1?'text-emerald-600':totalSpeedWeek>0?'text-amber-600':'text-slate-400'}`}>{totalSpeedWeek>0?formatNumber(totalSpeedWeek,2):'—'}</span>
                                {totalSpeedWeek>0&&<span className="text-[8px] font-bold text-orange-400 ml-1">m/h</span>}
                              </div>
                            </div>
                          </div>

                          {/* Lũy kế đến tuần này */}
                          <div className="p-4 bg-blue-50">
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className="w-2 h-2 rounded-full bg-blue-600"/>
                              <p className="text-[9px] font-black text-blue-700 uppercase tracking-widest">Lũy kế đến tuần này</p>
                            </div>
                            <div className="flex items-baseline gap-1 mb-2">
                              <span className="text-[22px] font-black text-blue-700">{totalCum.piles}</span>
                              <span className="text-[10px] font-bold text-blue-400">cọc</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              <div className="bg-white border border-blue-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-blue-400 uppercase mb-0.5">Chiều sâu</p>
                                <span className="text-[12px] font-black text-blue-700">{formatNumber(totalCum.depth,1)}</span>
                                <span className="text-[8px] font-bold text-blue-400 ml-1">m</span>
                              </div>
                              <div className="bg-white border border-blue-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-blue-400 uppercase mb-0.5">Thời gian</p>
                                <span className="text-[12px] font-black text-blue-700">{formatNumber(totalCum.dur,1)}</span>
                                <span className="text-[8px] font-bold text-blue-400 ml-1">h</span>
                              </div>
                              <div className="bg-white border border-blue-200 rounded-xl p-2">
                                <p className="text-[8px] font-bold text-blue-400 uppercase mb-0.5">Vận tốc TB</p>
                                {(() => { const s = totalCum.dur > 0 ? totalCum.depth/totalCum.dur : 0; return <><span className={`text-[12px] font-black ${s>=1?'text-emerald-600':s>0?'text-amber-600':'text-slate-400'}`}>{s>0?formatNumber(s,2):'—'}</span>{s>0&&<span className="text-[8px] font-bold text-blue-400 ml-1">m/h</span>}</>; })()}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        {totalCum.piles > 0 && (
                          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest shrink-0">Tuần này / Lũy kế:</span>
                            <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{width:`${totalPct.toFixed(1)}%`, background:'linear-gradient(90deg,#1a3a6b,#3b82f6)'}}/>
                            </div>
                            <span className="text-[9px] font-black text-blue-700 shrink-0">{totalPct.toFixed(1)}% tuần này</span>
                          </div>
                        )}

                        {/* Biểu đồ tổng hợp tất cả dự án theo tuần */}
                        {(() => {
                          const COLORS = ['#3b82f6','#f97316','#10b981','#8b5cf6','#f59e0b','#06b6d4','#ef4444','#84cc16'];
                          const allProjsSorted = [...new Set(history.map(r => r.project).filter(Boolean))]
                            .sort((a, b) => {
                              const pilesA = selectedWeekRecords.filter(r => r.project === a).length;
                              const pilesB = selectedWeekRecords.filter(r => r.project === b).length;
                              return pilesB - pilesA || a.localeCompare(b, 'vi');
                            });
                          const totalChartData = weekKeys.map(wk => {
                            const [cy,cm,cd] = wk.split('-').map(Number);
                            const dt = new Date(cy, cm-1, cd);
                            const jan1 = new Date(dt.getFullYear(), 0, 1);
                            const wNum = Math.ceil(((dt.getTime()-jan1.getTime())/86400000 + jan1.getDay() + 1) / 7);
                            const entry: Record<string,string|number> = { week: `T${wNum}`, _key: wk };
                            const recs = weeklyData[wk] || [];
                            allProjsSorted.forEach(p => { entry[p] = recs.filter(r => r.project === p).length; });
                            entry['_total'] = recs.length;
                            return entry;
                          });
                          const firstRealIdx = totalChartData.findIndex(r => parseInt((r.week as string).replace('T','')) <= 10);
                          const cleanData = firstRealIdx > 0 ? totalChartData.slice(firstRealIdx) : totalChartData;
                          return (
                            <div className="border-t border-slate-100">
                              <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                                <BarChart2 size={12} className="text-blue-600"/>
                                <span className="text-[9px] font-black text-blue-700 uppercase tracking-widest">Số cọc theo từng tuần · Tất cả dự án · Năm {weeklyYear}</span>
                              </div>
                              <div className="px-2 pb-3" id="chart-all-projects">
                                <ResponsiveContainer width="100%" height={180}>
                                  <BarChart data={cleanData} margin={{top:18,right:8,bottom:20,left:0}} barCategoryGap="15%">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                                    <XAxis dataKey="week" tick={{fontSize:9, fontWeight:700, fill:'#64748b'}} interval={0} tickLine={false} axisLine={{stroke:'#e2e8f0'}}/>
                                    <YAxis tick={{fontSize:9, fill:'#94a3b8'}} allowDecimals={false} width={20} axisLine={false} tickLine={false}/>
                                    <Tooltip
                                      contentStyle={{fontSize:11, borderRadius:8, border:'1px solid #e2e8f0', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                      formatter={(value:number) => [`${value} cọc`, 'Tổng số lượng']}
                                      cursor={{fill: '#f8fafc'}}
                                    />
                                    <Bar dataKey="_total" radius={[4,4,0,0]}>
                                      {cleanData.map((entry, index) => {
                                        const wNum = parseInt((entry.week as string).replace('T',''));
                                        const isCurrent = wNum === weekNo;
                                        return <Cell key={`cell-${index}`} fill={isCurrent ? '#f97316' : '#10b981'} />;
                                      })}
                                      <LabelList
                                        dataKey="_total"
                                        position="top"
                                        style={{fontSize:11, fontWeight:800, fill:'#1e293b'}}
                                        formatter={(v:number) => v > 0 ? v : ''}
                                      />
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {allProjs.map((proj, pidx) => {
                        const ACCENT = ['#3b82f6','#f97316','#10b981','#8b5cf6','#f59e0b','#06b6d4','#ef4444','#84cc16'];
                        const color = ACCENT[pidx % ACCENT.length];

                        // Lũy kế đến tuần trước (chỉ dự án này)
                        const projPrev = history.filter(r => {
                          const d = parseViDate(r.constructionEnd);
                          return r.project === proj && d && d.getTime() < weekStart.getTime();
                        });
                        // Thực hiện tuần này (chỉ dự án này)
                        const projWeek = selectedWeekRecords.filter(r => r.project === proj);
                        // Lũy kế đến tuần này (chỉ dự án này)
                        const projCum = history.filter(r => {
                          const d = parseViDate(r.constructionEnd);
                          return r.project === proj && d && d.getTime() <= weekEnd.getTime();
                        });

                        const pPrev = calcStats(projPrev);
                        const pWeek = {
                          piles: projWeek.length,
                          depth: projWeek.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.lengthMeters||0),0),0),
                          dur:   projWeek.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.durationHours||0),0),0),
                        };
                        const pCum  = calcStats(projCum);
                        const pSpeed = pWeek.dur > 0 ? pWeek.depth / pWeek.dur : 0;
                        const pct = pCum.piles > 0 ? Math.min(100, (pWeek.piles / pCum.piles) * 100) : 0;

                        return (
                          <div key={proj} className="bg-white border-2 rounded-2xl overflow-hidden shadow-md" style={{borderColor: color}}>
                            {/* Header dự án */}
                            <div className="px-5 py-2.5 flex items-center gap-3" style={{background: color}}>
                              <span className="w-6 h-6 rounded-lg bg-white/20 text-white text-[10px] font-black flex items-center justify-center shrink-0">{pidx+1}</span>
                              <p className="text-[11px] font-black text-white flex-1 truncate">{proj}</p>
                              <span className="text-[10px] font-black text-white/80 bg-white/20 px-2.5 py-0.5 rounded-full shrink-0">Tuần {weekNo}</span>
                            </div>

                            {/* 3 cột */}
                            <div className="grid grid-cols-3 divide-x divide-slate-200">
                              {/* Lũy kế đến tuần trước */}
                              <div className="p-4 bg-emerald-50">
                                <div className="flex items-center gap-1.5 mb-2">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500"/>
                                  <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Lũy kế đến tuần trước</p>
                                </div>
                                <div className="flex items-baseline gap-1 mb-2">
                                  <span className="text-[22px] font-black text-emerald-700">{pPrev.piles}</span>
                                  <span className="text-[10px] font-bold text-emerald-400">cọc</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <div className="bg-white border border-emerald-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-emerald-500 uppercase mb-0.5">Chiều sâu</p>
                                    <span className="text-[12px] font-black text-emerald-700">{formatNumber(pPrev.depth,1)}</span>
                                    <span className="text-[8px] font-bold text-emerald-400 ml-1">m</span>
                                  </div>
                                  <div className="bg-white border border-emerald-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-emerald-500 uppercase mb-0.5">Thời gian</p>
                                    <span className="text-[12px] font-black text-emerald-700">{formatNumber(pPrev.dur,1)}</span>
                                    <span className="text-[8px] font-bold text-emerald-400 ml-1">h</span>
                                  </div>
                                  <div className="bg-white border border-emerald-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-emerald-500 uppercase mb-0.5">Vận tốc TB</p>
                                    {(() => { const s = pPrev.dur > 0 ? pPrev.depth/pPrev.dur : 0; return <><span className={`text-[12px] font-black ${s>=1?'text-emerald-700':s>0?'text-amber-600':'text-slate-400'}`}>{s>0?formatNumber(s,2):'—'}</span>{s>0&&<span className="text-[8px] font-bold text-emerald-400 ml-1">m/h</span>}</>; })()}
                                  </div>
                                </div>
                              </div>

                              {/* Thực hiện tuần này */}
                              <div className="p-4 bg-orange-50 relative">
                                {pWeek.piles > 0 && (
                                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-orange-500 animate-pulse"/>
                                )}
                                <div className="flex items-center gap-1.5 mb-2">
                                  <div className="w-2 h-2 rounded-full bg-orange-500"/>
                                  <p className="text-[9px] font-black text-orange-700 uppercase tracking-widest">Thực hiện tuần này</p>
                                </div>
                                <div className="flex items-baseline gap-1 mb-2">
                                  <span className={`text-[22px] font-black ${pWeek.piles > 0 ? 'text-orange-600' : 'text-slate-400'}`}>{pWeek.piles}</span>
                                  <span className="text-[10px] font-bold text-orange-400">cọc</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <div className="bg-white border border-orange-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-orange-400 uppercase mb-0.5">Chiều sâu</p>
                                    <span className="text-[12px] font-black text-orange-600">{formatNumber(pWeek.depth,1)}</span>
                                    <span className="text-[8px] font-bold text-orange-400 ml-1">m</span>
                                  </div>
                                  <div className="bg-white border border-orange-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-orange-400 uppercase mb-0.5">Thời gian</p>
                                    <span className="text-[12px] font-black text-orange-600">{formatNumber(pWeek.dur,1)}</span>
                                    <span className="text-[8px] font-bold text-orange-400 ml-1">h</span>
                                  </div>
                                  <div className="bg-white border border-orange-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-orange-400 uppercase mb-0.5">Vận tốc TB</p>
                                    <span className={`text-[12px] font-black ${pSpeed>=1?'text-emerald-600':pSpeed>0?'text-amber-600':'text-slate-400'}`}>{pSpeed>0?formatNumber(pSpeed,2):'—'}</span>
                                    {pSpeed>0&&<span className="text-[8px] font-bold text-orange-400 ml-1">m/h</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Lũy kế đến tuần này */}
                              <div className="p-4 bg-blue-50">
                                <div className="flex items-center gap-1.5 mb-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-600"/>
                                  <p className="text-[9px] font-black text-blue-700 uppercase tracking-widest">Lũy kế đến tuần này</p>
                                </div>
                                <div className="flex items-baseline gap-1 mb-2">
                                  <span className="text-[22px] font-black text-blue-700">{pCum.piles}</span>
                                  <span className="text-[10px] font-bold text-blue-400">cọc</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <div className="bg-white border border-blue-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-blue-400 uppercase mb-0.5">Chiều sâu</p>
                                    <span className="text-[12px] font-black text-blue-700">{formatNumber(pCum.depth,1)}</span>
                                    <span className="text-[8px] font-bold text-blue-400 ml-1">m</span>
                                  </div>
                                  <div className="bg-white border border-blue-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-blue-400 uppercase mb-0.5">Thời gian</p>
                                    <span className="text-[12px] font-black text-blue-700">{formatNumber(pCum.dur,1)}</span>
                                    <span className="text-[8px] font-bold text-blue-400 ml-1">h</span>
                                  </div>
                                  <div className="bg-white border border-blue-200 rounded-xl p-2">
                                    <p className="text-[8px] font-bold text-blue-400 uppercase mb-0.5">Vận tốc TB</p>
                                    {(() => { const s = pCum.dur > 0 ? pCum.depth/pCum.dur : 0; return <><span className={`text-[12px] font-black ${s>=1?'text-emerald-600':s>0?'text-amber-600':'text-slate-400'}`}>{s>0?formatNumber(s,2):'—'}</span>{s>0&&<span className="text-[8px] font-bold text-blue-400 ml-1">m/h</span>}</>; })()}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Progress bar tuần này / lũy kế */}
                            {pCum.piles > 0 && (
                              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest shrink-0">Tuần này / Lũy kế:</span>
                                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{width:`${pct.toFixed(1)}%`, background: color}}
                                  />
                                </div>
                                <span className="text-[9px] font-black shrink-0" style={{color}}>{pct.toFixed(1)}% tuần này</span>
                              </div>
                            )}

                            {/* Biểu đồ cột: số cọc theo từng tuần của dự án này */}
                            {(() => {
                              const projChartData = weekKeys.map(wk => {
                                const recs = (weeklyData[wk] || []).filter(r => r.project === proj);
                                const [cy,cm,cd] = wk.split('-').map(Number);
                                const dt = new Date(cy, cm-1, cd);
                                const jan1 = new Date(dt.getFullYear(), 0, 1);
                                const wNum = Math.ceil(((dt.getTime()-jan1.getTime())/86400000 + jan1.getDay() + 1) / 7);
                                return { week: `T${wNum}`, 'Số cọc': recs.length, _key: wk };
                              });
                              if (projChartData.length === 0) return null;
                              return (
                                <div className="border-t border-slate-100">
                                  <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                                    <BarChart2 size={12} style={{color}}/>
                                    <span className="text-[9px] font-black uppercase tracking-widest" style={{color}}>Số cọc theo từng tuần · Năm {weeklyYear}</span>
                                  </div>
                                  <div className="px-2 pb-3" id={`chart-proj-${pidx}`}>
                                    <ResponsiveContainer width="100%" height={180}>
                                      {(() => {
                                        // Lọc bỏ tuần T52/T53 xuất hiện ở đầu năm (thuộc năm trước)
                                        const firstRealIdx = projChartData.findIndex(r => {
                                          const n = parseInt((r.week as string).replace('T',''));
                                          return n <= 10;
                                        });
                                        const cleanData = firstRealIdx > 0 ? projChartData.slice(firstRealIdx) : projChartData;
                                        return (
                                          <BarChart data={cleanData} margin={{top:18,right:8,bottom:20,left:0}} barCategoryGap="15%">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                                            <XAxis
                                              dataKey="week"
                                              tick={{fontSize:9, fontWeight:700, fill:'#64748b'}}
                                              interval={0}
                                              tickLine={false}
                                              axisLine={{stroke:'#e2e8f0'}}
                                            />
                                            <YAxis tick={{fontSize:9, fill:'#94a3b8'}} allowDecimals={false} width={20} axisLine={false} tickLine={false}/>
                                            <Tooltip
                                              contentStyle={{fontSize:11, borderRadius:8, border:'1px solid #e2e8f0', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                              formatter={(value:number) => [`${value} cọc`, 'Số lượng']}
                                              cursor={{fill: '#f8fafc'}}
                                            />
                                            <Bar dataKey="Số cọc" radius={[4,4,0,0]}>
                                              {cleanData.map((entry, i) => {
                                                const wNum = parseInt((entry.week as string).replace('T',''));
                                                const isCurrent = wNum === weekNo;
                                                return (
                                                  <Cell
                                                    key={i}
                                                    fill={isCurrent ? '#f97316' : '#10b981'}
                                                  />
                                                );
                                              })}
                                              <LabelList
                                                dataKey="Số cọc"
                                                position="top"
                                                style={{fontSize:11, fontWeight:800, fill:'#1e293b'}}
                                                formatter={(v:number) => v > 0 ? v : ''}
                                              />
                                            </Bar>
                                          </BarChart>
                                        );
                                      })()}
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* ── Biểu đồ cột: số cọc theo từng tuần — đã chuyển vào trong từng card dự án ── */}

                {/* Per-project pile list */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {weeklyProjectStats.map((ps, idx) => {
                    const accentColors = ['border-blue-700','border-blue-700','border-blue-700','border-blue-700','border-blue-700','border-blue-700'];
                    const pillColors = ['bg-blue-500','bg-orange-500','bg-emerald-500','bg-violet-500','bg-amber-500','bg-cyan-500'];
                    return (
                      <div key={ps.proj} className={`bg-white border-2 ${accentColors[idx % accentColors.length]} rounded-2xl overflow-hidden shadow-sm`}>
                        <div className="px-4 py-3 border-b border-blue-900 flex items-center justify-between" style={{background:'linear-gradient(135deg,#1a3a6b 0%,#1e4480 100%)'}}>
                          <div>
                            <p className="text-[11px] font-black text-white">{ps.proj}</p>
                            <p className="text-[9px] text-blue-200 font-medium mt-0.5">{ps.totalPiles} cọc · {formatNumber(ps.totalDepth, 1)}m · {formatNumber(ps.avgSpeed, 2)} m/h</p>
                          </div>
                          <span className={`text-[11px] font-black text-white ${pillColors[idx % pillColors.length]} px-3 py-1 rounded-full`}>{ps.totalPiles} cọc</span>
                        </div>
                        <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                          {ps.recs.map((r, ri) => {
                            const depth = (r.layers||[]).reduce((s,l)=>s+(l.lengthMeters||0),0);
                            const dur = (r.layers||[]).reduce((s,l)=>s+(l.durationHours||0),0);
                            const spd = dur > 0 ? depth/dur : 0;
                            const hasSlowLayer = (r.layers||[]).slice(0, -2).some(l => l.speedMph > 0 && l.speedMph < 1);
                            return (
                              <div key={r.id} className={`px-4 py-2.5 flex items-center gap-3 transition-colors group ${hasSlowLayer ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>
                                <span className="text-[9px] font-black text-slate-400 w-4 shrink-0">{ri+1}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-black text-slate-800 truncate">{r.pileId || r.componentName || '—'}</span>
                                    {r.diameter && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">{r.diameter}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {r.constructionEnd && <span className="text-[9px] text-slate-400 font-medium">{r.constructionEnd}</span>}
                                    <span className="text-[9px] font-bold text-slate-600">{formatNumber(depth,1)}m</span>
                                    {spd > 0 && <span className={`text-[9px] font-bold ${spd >= 1 ? 'text-emerald-600' : 'text-red-600'}`}>{formatNumber(spd,2)} m/h</span>}
                                  </div>
                                </div>
                                <button onClick={()=>onEdit(r)} className="opacity-0 group-hover:opacity-100 text-[9px] font-black px-2 py-1 bg-blue-50 text-blue-600 rounded-lg border border-blue-100 hover:bg-blue-600 hover:text-white transition-all">Xem</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Cảnh báo vận tốc thấp trong tuần (Bỏ qua 2 lớp cuối mỗi biên bản) ── */}
                {(() => {
                  const slowInWeek = selectedWeekRecords.filter(r =>
                    (r.layers||[]).slice(0, -2).some(l => l.speedMph > 0 && l.speedMph < 1)
                  );
                  if (slowInWeek.length === 0) return null;
                  return (
                    <div className="bg-red-50 border-2 border-red-300 rounded-2xl overflow-hidden shadow-md animate-in fade-in duration-300">
                      {/* Header */}
                      <div className="px-5 py-3 bg-red-600 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-white/20 rounded-lg">
                            <AlertCircle size={15} className="text-white" />
                          </div>
                          <div>
                            <h5 className="text-[11px] font-black text-white uppercase tracking-widest">
                              Cảnh báo vận tốc khoan thấp &lt; 1 m/h — Tuần {weekNo}
                            </h5>
                            <p className="text-[9px] text-red-100 font-medium mt-0.5">
                              Các cọc dưới đây có ít nhất 1 đoạn khoan với vận tốc &lt; 1 m/h trong tuần này
                            </p>
                          </div>
                        </div>
                        <span className="bg-white text-red-600 text-[11px] font-black px-3 py-1 rounded-full shrink-0">
                          {slowInWeek.length} cọc
                        </span>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-red-100 border-b border-red-200">
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest">#</th>
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest">Dự án</th>
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest">Số hiệu cọc</th>
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest">Đường kính</th>
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest">Ngày kết thúc</th>
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest">Đoạn chậm (Lớp — Vận tốc)</th>
                              <th className="px-4 py-2.5 text-[9px] font-black text-red-700 uppercase tracking-widest text-center">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody>
                            {slowInWeek.map((r, si) => {
                              const slowLayers = (r.layers||[]).slice(0, -2).filter(l => l.speedMph > 0 && l.speedMph < 1);
                              return (
                                <tr key={r.id} className={`border-b border-red-100 ${si % 2 === 0 ? 'bg-white' : 'bg-red-50'} hover:bg-red-100 transition-colors`}>
                                  <td className="px-4 py-3">
                                    <span className="w-6 h-6 rounded-lg bg-red-500 text-white text-[10px] font-black flex items-center justify-center">{si+1}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className="text-[11px] font-black text-slate-800 max-w-[180px] truncate">{r.project || '—'}</p>
                                    <p className="text-[9px] text-slate-400 font-medium truncate max-w-[180px]">{r.item || r.componentName || ''}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-[12px] font-black text-red-700">{r.pileId || '—'}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">{r.diameter || '—'}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-[10px] font-bold text-slate-600">{r.constructionEnd || '—'}</span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1.5">
                                      {slowLayers.map((l, li) => (
                                        <div key={li} className="flex items-center gap-1 bg-red-100 border border-red-200 rounded-lg px-2 py-1">
                                          <span className="text-[9px] font-black text-red-800">
                                            Lớp {l.layerNumber}
                                          </span>
                                          <span className="text-[9px] text-red-500 font-medium">·</span>
                                          <span className="text-[10px] font-black text-red-700">{toNum(l.speedMph).toFixed(2)} m/h</span>
                                          {l.layerDesign && (
                                            <span className="text-[8px] text-red-500 font-medium ml-0.5 max-w-[80px] truncate" title={l.layerDesign}>
                                              · {l.layerDesign}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <button
                                      onClick={() => onEdit(r)}
                                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1 mx-auto"
                                    >
                                      <Edit2 size={10} /> Xem
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-red-100 border-t-2 border-red-300">
                              <td colSpan={7} className="px-4 py-2.5">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="text-[9px] font-black text-red-700 uppercase tracking-widest">Tổng kết tuần {weekNo}:</span>
                                  <span className="text-[10px] font-bold text-red-700">
                                    {slowInWeek.length}/{selectedWeekRecords.length} cọc có đoạn chậm
                                  </span>
                                  <span className="text-[9px] text-red-500 font-medium">·</span>
                                  <span className="text-[10px] font-bold text-red-700">
                                    {slowInWeek.reduce((s,r)=>(r.layers||[]).slice(0, -2).filter(l=>l.speedMph>0&&l.speedMph<1).length+s, 0)} đoạn &lt; 1 m/h
                                  </span>
                                  <span className="text-[9px] text-red-500 font-medium">·</span>
                                  <span className="text-[10px] font-bold text-red-700">
                                    Tốc độ thấp nhất: {Math.min(...slowInWeek.flatMap(r=>(r.layers||[]).slice(0, -2).filter(l=>l.speedMph>0&&l.speedMph<1).map(l=>l.speedMph))).toFixed(2)} m/h
                                  </span>
                                </div>
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {selectedWeekKey && selectedWeekRecords.length === 0 && (() => {
            const weekStart = getWeekStartDate(selectedWeekKey);
            const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
            const startOfYear = new Date(weekStart.getFullYear(), 0, 1);
            const weekNo = Math.ceil(((weekStart.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
            const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
            const isCurrentWeek = selectedWeekKey === getWeekKey(new Date());
            // Lũy kế đến cuối tuần này (dù không có cọc mới)
            const cumRecords = history.filter(r => {
              const d = parseViDate(r.constructionEnd);
              return d && d.getTime() <= weekEnd.getTime();
            });
            const cumDepth = cumRecords.reduce((s,r)=>s+(r.layers||[]).reduce((ls,l)=>ls+(l.lengthMeters||0),0),0);
            return (
              <div className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-in fade-in duration-300">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-5 bg-slate-300 rounded-full"/>
                    <div>
                      <h4 className="text-[13px] font-black text-slate-600 uppercase tracking-wide">
                        Tuần {weekNo} · {fmtDate(weekStart)} – {fmtDate(weekEnd)}
                      </h4>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">Thứ 6 → Thứ 5</p>
                    </div>
                  </div>
                  {isCurrentWeek && (
                    <span className="text-[10px] font-black text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1 rounded-full">★ Tuần hiện tại</span>
                  )}
                </div>
                <div className="p-8 flex flex-col items-center gap-4 text-center">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
                    <Calendar size={24} className="text-slate-300"/>
                  </div>
                  <div>
                    <p className="text-[14px] font-black text-slate-500">Tuần này chưa có biên bản thi công</p>
                    <p className="text-[11px] text-slate-400 font-medium mt-1">
                      {isCurrentWeek ? 'Dữ liệu sẽ xuất hiện khi có biên bản được upload với ngày kết thúc trong tuần này' : 'Không có cọc nào được ghi nhận trong tuần này'}
                    </p>
                  </div>
                  {cumRecords.length > 0 && (
                    <div className="flex items-center gap-6 mt-2 pt-4 border-t border-slate-100 w-full justify-center">
                      <div className="text-center">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Lũy kế đến tuần này</p>
                        <span className="text-[20px] font-black text-blue-600">{cumRecords.length}</span>
                        <span className="text-[10px] font-bold text-blue-400 ml-1">cọc</span>
                      </div>
                      <div className="w-px h-10 bg-slate-200"/>
                      <div className="text-center">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Tổng chiều sâu lũy kế</p>
                        <span className="text-[20px] font-black text-blue-600">{formatNumber(cumDepth,1)}</span>
                        <span className="text-[10px] font-bold text-blue-400 ml-1">m</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {dashTab === 'overview' && <>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Tổng số cọc', value: totalPiles, unit: 'cọc', color: 'bg-blue-600', icon: <Layers className="w-5 h-5 text-white" /> },
          { label: 'Tổng chiều sâu', value: formatNumber(totalDepth, 1), unit: 'm', color: 'bg-orange-500', icon: <ArrowDownToLine className="text-white w-5 h-5" /> },
          { label: 'Tốc độ khoan TB', value: formatNumber(avgSpeed), unit: 'm/h', color: 'bg-emerald-500', icon: <TrendingUp className="w-5 h-5 text-white" /> },
          { label: 'Số dự án', value: projects.length, unit: 'dự án', color: 'bg-violet-500', icon: <Building2 className="w-5 h-5 text-white" /> },
        ].map((kpi, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2 rounded-xl ${kpi.color}`}>{kpi.icon}</div>
            </div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{kpi.label}</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-slate-900">{kpi.value}</span>
              <span className="text-xs font-bold text-slate-400">{kpi.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Cảnh báo trùng Hạng mục + Số hiệu cọc ── */}
      {/* ── Cảnh báo không nhất quán địa chất ── */}
      {inconsistentRecords.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-red-500 rounded-lg">
              <AlertCircle size={16} className="text-white" />
            </div>
            <h4 className="text-[11px] font-black text-red-800 uppercase tracking-widest">
              Cảnh báo dữ liệu địa chất không nhất quán
            </h4>
            <span className="ml-auto bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
              {inconsistentRecords.length} biên bản lỗi
            </span>
          </div>
          <p className="text-[11px] text-red-700 font-medium mb-4">
            Các biên bản dưới đây có <strong>cùng số thứ tự địa chất thực tế</strong> nhưng <strong>mô tả lớp thiết kế khác nhau</strong> — AI có thể đã quét sai. Vui lòng quét lại hoặc chỉnh sửa thủ công.
          </p>
          <div className="space-y-3">
            {inconsistentRecords.map(({ result: rec, conflicts }) => (
              <div key={rec.id} className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
                {/* Biên bản header */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-red-100 border-b border-red-200">
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-black text-red-900 truncate max-w-xs">{rec.componentName || '(Chưa có)'}</span>
                    {rec.pileId && <span className="text-[11px] font-black text-red-700 bg-red-200 px-2 py-0.5 rounded-full shrink-0">{rec.pileId}</span>}
                    {rec.diameter && <span className="text-[10px] text-red-600 font-bold shrink-0">{rec.diameter}</span>}
                    {rec.constructionEnd && <span className="text-[10px] text-red-500 font-medium shrink-0">{rec.constructionEnd}</span>}
                  </div>
                  <span className="text-[10px] font-black text-red-700 bg-red-200 px-2 py-0.5 rounded-full shrink-0">
                    {conflicts.length} xung đột
                  </span>
                </div>

                {/* Chi tiết các xung đột */}
                <div className="divide-y divide-red-100">
                  {conflicts.map(({ geology, designs }) => (
                    <div key={geology} className="px-4 py-2.5 flex items-start gap-3">
                      <span className="w-7 h-7 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                        {geology}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-[10px] font-black text-red-700 uppercase tracking-wider">Địa chất TT số {geology} — {designs.length} mô tả khác nhau:</p>
                        {designs.map((d, di) => (
                          <div key={di} className="flex items-start gap-2">
                            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${di === 0 ? 'bg-blue-400' : 'bg-orange-400'}`} />
                            <span className="text-[11px] text-slate-700">{d}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="px-4 py-2.5 bg-red-50 border-t border-red-100 flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-red-500 font-medium flex-1">
                    MK: {rec.reportNumber || '—'} · {rec.constructionStart || '—'} → {rec.constructionEnd || '—'}
                  </span>
                  <button
                    onClick={() => onEdit(rec)}
                    className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
                  >
                    <RotateCcw size={11} /> Quét lại AI
                  </button>
                  <button
                    onClick={() => onEdit(rec)}
                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
                  >
                    <Edit2 size={11} /> Chỉnh sửa
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {duplicateGroups.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 bg-amber-500 rounded-lg">
              <AlertCircle size={16} className="text-white" />
            </div>
            <h4 className="text-[11px] font-black text-amber-800 uppercase tracking-widest">
              Cảnh báo trùng Tên bộ phận &amp; Số hiệu cọc
            </h4>
            <span className="ml-auto bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
              {duplicateGroups.length} nhóm trùng
            </span>
          </div>
          <p className="text-[11px] text-amber-700 font-medium mb-4">
            Các biên bản dưới đây có cùng <strong>Tên bộ phận</strong> và <strong>Số hiệu cọc</strong>. Vui lòng kiểm tra lại để tránh nhập liệu trùng lặp.
          </p>
          <div className="space-y-3">
            {duplicateGroups.map((group) => (
              <div key={group.key} className="bg-white border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-100 border-b border-amber-200">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest shrink-0">Tên bộ phận:</span>
                    <span className="text-[12px] font-bold text-amber-900 truncate">{group.item || '(Chưa có)'}</span>
                    <span className="mx-2 text-amber-400">|</span>
                    <span className="text-[10px] font-black text-amber-900 uppercase tracking-widest shrink-0">Số hiệu cọc:</span>
                    <span className="text-[13px] font-black text-amber-700 bg-amber-200 px-2 py-0.5 rounded-full shrink-0">{group.pileId || '(Chưa có)'}</span>
                  </div>
                  <span className="text-[10px] font-black text-amber-700 bg-amber-200 px-2 py-0.5 rounded-full shrink-0">
                    {group.records.length} bản ghi
                  </span>
                </div>
                {/* Records list */}
                <div className="divide-y divide-amber-100">
                  {group.records.map((rec, ri) => (
                    <div key={rec.id} className="flex items-center gap-3 px-4 py-2 hover:bg-amber-50 transition-colors group">
                      <span className="text-[10px] font-black text-amber-400 w-5 shrink-0">#{ri + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-slate-800 truncate">{rec.project || '—'}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          MK: <span className="font-bold">{rec.reportNumber || '—'}</span>
                          {rec.constructionStart && <> · Bắt đầu: <span className="font-bold">{rec.constructionStart}</span></>}
                          {rec.fileName && <> · File: <span className="font-bold">{rec.fileName}</span></>}
                        </p>
                      </div>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onEdit(rec)}
                          className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
                        >
                          Xem
                        </button>
                        <button
                          onClick={() => onDelete(rec.id)}
                          className="px-3 py-1 bg-red-50 text-red-500 rounded-lg text-[10px] font-black uppercase hover:bg-red-600 hover:text-white transition-all border border-red-100"
                        >
                          Xóa
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Cảnh báo biên bản thiếu dữ liệu ── */}
      {missingDataRecords.length > 0 && (
        <div className="bg-violet-50 border border-violet-300 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-violet-600 rounded-lg shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[11px] font-black text-violet-800 uppercase tracking-widest">
                Cảnh báo biên bản thiếu dữ liệu
              </h4>
              <p className="text-[10px] text-violet-600 font-medium mt-0.5">
                Các biên bản dưới đây thiếu ảnh gốc, file Excel hoặc dữ liệu địa chất. Hãy cập nhật để đảm bảo đồng bộ đầy đủ.
              </p>
            </div>
            <span className="bg-violet-600 text-white text-[10px] font-black px-2.5 py-1 rounded-full shrink-0">
              {missingDataRecords.length} biên bản
            </span>
          </div>

          {/* Thống kê nhanh theo loại */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(() => {
              const imgCount   = missingDataRecords.filter(r => r.missing.some(m => m.type === 'image')).length;
              const xlsxCount  = missingDataRecords.filter(r => r.missing.some(m => m.type === 'excel')).length;
              const layerCount = missingDataRecords.filter(r => r.missing.some(m => m.type === 'supabase')).length;
              return (
                <>
                  {imgCount   > 0 && <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border bg-purple-100 text-purple-700 border-purple-200">🖼️ Thiếu ảnh/PDF: <strong>{imgCount}</strong></span>}
                  {xlsxCount  > 0 && <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border bg-orange-100 text-orange-700 border-orange-200">📊 Thiếu Excel: <strong>{xlsxCount}</strong></span>}
                  {layerCount > 0 && <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border bg-red-100 text-red-700 border-red-200">🗄️ Thiếu địa chất: <strong>{layerCount}</strong></span>}
                </>
              );
            })()}
          </div>

          <div className="space-y-2">
            {missingDataRecords.map(({ result: rec, missing }) => (
              <div key={rec.id} className="bg-white border border-violet-200 rounded-xl overflow-hidden shadow-sm">
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-violet-50 transition-colors group">
                  {/* Số thứ tự */}
                  <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-black text-violet-700">{rec.stt ?? '—'}</span>
                  </div>

                  {/* Thông tin biên bản */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-black text-slate-800 truncate max-w-[180px]">
                        {rec.componentName || '(Chưa có tên)'}
                      </span>
                      {rec.pileId && (
                        <span className="text-[10px] font-black text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full shrink-0">
                          {rec.pileId}
                        </span>
                      )}
                      {rec.diameter && (
                        <span className="text-[10px] text-slate-500 font-bold shrink-0">{rec.diameter}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {/* Badges thiếu dữ liệu */}
                      {missing.map(m => (
                        <span key={m.type} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${missingBadge(m.type)}`}>
                          {missingIcon(m.type)} {m.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onSelectResult(rec)}
                      className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg text-[10px] font-black uppercase hover:bg-violet-600 hover:text-white transition-all border border-violet-200"
                    >
                      Xem
                    </button>
                    <button
                      onClick={() => onEdit(rec)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
                    >
                      Sửa
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bảng Tổng hợp thống kê theo Cấp đất đá ── */}
      <div className="bg-white border-2 border-slate-400 rounded-3xl overflow-hidden shadow-md mt-8">
        <div className="px-6 py-4 border-b-2 border-slate-400 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-blue-300" />
            <h4 className="text-[12px] font-black text-white uppercase tracking-widest">
              Tổng hợp thống kê theo Cấp đất đá
            </h4>
          </div>
          <div className="flex items-center gap-3">
            {(() => {
              const diameters = Array.from(new Set(soilClassStats.map(s => s.diameter))).sort((a, b) => {
                const na = parseInt(a.replace(/\D/g, '')) || 0;
                const nb = parseInt(b.replace(/\D/g, '')) || 0;
                return na - nb;
              });
              return diameters.length > 1 ? (
                <select
                  className="text-[12px] font-semibold bg-white border border-white/40 text-slate-800 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer shadow-sm"
                  onChange={e => {
                    const val = e.target.value;
                    const rows = document.querySelectorAll('[data-soil-dia-row]');
                    rows.forEach((r: any) => {
                      r.style.display = (!val || r.dataset.soilDiaRow === val) ? '' : 'none';
                    });
                  }}
                >
                  <option value="">Tất cả đường kính</option>
                  {diameters.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : null;
            })()}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr style={{ background: '#e0f2f1' }}>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-10">STT</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-24">Đường kính</th>
                <th className="px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 border border-teal-200">Cấp đất đá</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-20">Số cọc</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-20">Số mẫu</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-28">Tổng dài (m)</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-28">T.Gian (h)</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-24">V.Min</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-24">V.Max</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-teal-200 w-24">V.TB (m/h)</th>
              </tr>
            </thead>
            <tbody>
              {soilClassStats.map((stat, i) => {
                const avgSpd = stat.totalDuration > 0 ? stat.totalLength / stat.totalDuration : 0;
                const rowBg = i % 2 === 0 ? '#ffffff' : '#f0fdfa';
                return (
                  <tr key={i} data-soil-dia-row={stat.diameter} style={{ background: rowBg }} className="border-b border-teal-50 hover:bg-teal-50/50 transition-colors cursor-pointer"
                    onClick={() => {
                      // Lọc các biên bản thuộc nhóm này
                      const piles = history.filter(res =>
                        (res.diameter || '—').trim() === stat.diameter &&
                        (res.layers || []).some(l => {
                          const sc = SOIL_CLASSES.includes((l.soilClass || '').trim()) ? l.soilClass.trim() : 'Chưa Phân định nhóm';
                          return sc === stat.layerDesign;
                        })
                      );
                      setSoilDrillDown({ diameter: stat.diameter, soilClass: stat.layerDesign, piles });
                    }}
                  >
                    <td className="px-3 py-2.5 text-xs text-center text-slate-400 font-mono border-r border-teal-50">{i + 1}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold text-teal-700 border-r border-teal-50">{stat.diameter}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `#${GROUP_COLORS[stat.colorIdx].bg}` }} />
                        <span className="text-xs font-bold text-slate-700">{stat.layerDesign}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold text-slate-600 border-l border-teal-50">{stat.pileIds.size}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold text-slate-600 border-l border-teal-50">{stat.segments}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold text-slate-800 border-l border-teal-50">{stat.totalLength.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-bold text-slate-500 border-l border-teal-50">{stat.totalDuration.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-medium text-slate-500 border-l border-teal-50">{stat.minSpeed === Infinity ? '—' : stat.minSpeed.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-medium text-slate-500 border-l border-teal-50">{stat.maxSpeed === -Infinity ? '—' : stat.maxSpeed.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs text-center font-black text-teal-600 border-l border-teal-50">{avgSpd.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal Drill-down: danh sách cọc theo nhóm đất đá ── */}
      {soilDrillDown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSoilDrillDown(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-slate-200" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{soilDrillDown.diameter}</p>
                <h3 className="text-white font-black text-[15px] mt-0.5">{soilDrillDown.soilClass}</h3>
                <p className="text-teal-300 text-[11px] mt-0.5">{soilDrillDown.piles.length} biên bản liên quan</p>
              </div>
              <button onClick={() => setSoilDrillDown(null)} className="text-white/60 hover:text-white text-xl font-bold transition-colors">✕</button>
            </div>
            {/* List */}
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {soilDrillDown.piles.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-400 text-sm">Không có biên bản nào</div>
              ) : (
                soilDrillDown.piles.map((res, idx) => (
                  <div key={res.id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400 font-mono w-6">{idx + 1}</span>
                      <div>
                        <p className="text-[13px] font-bold text-slate-800">{res.pileId || '—'}</p>
                        <p className="text-[11px] text-slate-500">{res.componentName || ''} · {res.constructionEnd || ''}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSoilDrillDown(null); onEdit(res); }}
                      className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-[11px] font-black hover:bg-teal-700 transition-all whitespace-nowrap"
                    >
                      Xem chi tiết →
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Bảng Tổng hợp thống kê theo lớp thiết kế ── */}
      <div className="bg-white border-2 border-slate-400 rounded-3xl overflow-hidden shadow-md mt-8">
        <div className="px-6 py-4 border-b-2 border-slate-400 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #1a3a6b 0%, #1e4480 100%)' }}>
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-blue-300" />
            <h4 className="text-[12px] font-black text-white uppercase tracking-widest">
              Tổng hợp thống kê theo lớp thiết kế
            </h4>
          </div>
          <div className="flex items-center gap-3">
            {/* Dropdown lọc đường kính */}
            {(() => {
              const diameters = Array.from(new Set(designLayerStats.map(s => s.diameter))).sort((a, b) => {
                const na = parseInt(a.replace(/\D/g, '')) || 0;
                const nb = parseInt(b.replace(/\D/g, '')) || 0;
                return na - nb;
              });
              return diameters.length > 1 ? (
                <select
                  id="dia-filter"
                  className="text-[12px] font-semibold bg-white border border-white/40 text-slate-800 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer shadow-sm"
                  onChange={e => {
                    const val = e.target.value;
                    const rows = document.querySelectorAll('[data-dia-row]');
                    rows.forEach((r: any) => {
                      r.style.display = (!val || r.dataset.diaRow === val) ? '' : 'none';
                    });
                  }}
                >
                  <option value="">Tất cả đường kính</option>
                  {diameters.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : null;
            })()}
            <button
              onClick={() => !isExportingAll && onExportAll(history)}
              disabled={isExportingAll}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-sm hover:shadow-md",
                isExportingAll ? "bg-slate-400 cursor-not-allowed" : "bg-emerald-500 hover:bg-emerald-400"
              )}
            >
              {isExportingAll ? (
                <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>Đang xuất...</>
              ) : (
                <><FileDown size={14} />Xuất Excel</>
              )}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr style={{ background: '#fff3e0' }}>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-10">STT</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-24">Đường kính</th>
                <th className="px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 border border-orange-200">Mô tả lớp thiết kế tương ứng</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-20">Số cọc</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-20">Số mẫu</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-28">Tổng dài (m)</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-28">T.Gian (h)</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-24">V.Min</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-24">V.Max</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-wider text-slate-800 text-center border border-orange-200 w-24">V.TB (m/h)</th>
              </tr>
            </thead>
            <tbody>
              {designLayerStats.map((stat, i) => {
                const avgSpd = stat.totalDuration > 0 ? stat.totalLength / stat.totalDuration : 0;
                const isSlow = avgSpd > 0 && avgSpd <= 1;
                const isFast = avgSpd >= 5;
                const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
                return (
                  <tr key={i} data-dia-row={stat.diameter} style={{ background: rowBg }} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-3 py-3 text-[12px] text-slate-800 text-center border border-slate-200">{i + 1}</td>
                    <td className="px-3 py-3 text-[12px] font-semibold text-slate-800 text-center border border-slate-200">{stat.diameter}</td>
                    <td className="px-4 py-3 text-[12px] text-slate-800 border border-slate-200 leading-snug">{stat.layerDesign}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-800 text-center border border-slate-200">{stat.pileIds.size}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-800 text-center border border-slate-200">{stat.segments}</td>
                    <td className="px-3 py-3 text-[12px] font-semibold text-blue-600 text-center border border-slate-200">{stat.totalLength.toFixed(2)}</td>
                    <td className="px-3 py-3 text-[12px] font-semibold text-indigo-600 text-center border border-slate-200">{stat.totalDuration.toFixed(2)}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-800 text-center border border-slate-200">{stat.minSpeed === Infinity ? '—' : stat.minSpeed.toFixed(2)}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-800 text-center border border-slate-200">{stat.maxSpeed === -Infinity ? '—' : stat.maxSpeed.toFixed(2)}</td>
                    <td className="px-3 py-3 text-center border border-slate-200">
                      <span className={cn(
                        "inline-block px-3 py-0.5 rounded-full text-[12px] font-black min-w-[52px] text-center",
                        isSlow ? "bg-red-500 text-white shadow-sm" :
                        isFast ? "bg-emerald-100 text-emerald-700 border border-emerald-200" :
                        "bg-orange-100 text-orange-700 border border-orange-200"
                      )}>{avgSpd.toFixed(2)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f1f5f9', borderTop: '2px solid #94a3b8' }}>
                <td colSpan={3} className="px-5 py-3 text-[12px] font-black text-slate-900 uppercase tracking-widest border border-slate-300">Tổng hợp toàn bộ</td>
                <td className="px-3 py-3 text-[12px] font-black text-slate-900 text-center border border-slate-300">{allPileIdsCount}</td>
                <td className="px-3 py-3 text-[12px] font-black text-slate-900 text-center border border-slate-300">{totalSegments}</td>
                <td className="px-3 py-3 text-[12px] font-black text-slate-900 text-center border border-slate-300">{totalLen.toFixed(2)}</td>
                <td className="px-3 py-3 text-[12px] font-black text-slate-900 text-center border border-slate-300">{totalDur.toFixed(2)}</td>
                <td className="px-3 py-3 text-[12px] font-black text-slate-900 text-center border border-slate-300">{globalMinSpeed === Infinity ? '—' : globalMinSpeed.toFixed(2)}</td>
                <td className="px-3 py-3 text-[12px] font-black text-slate-900 text-center border border-slate-300">{globalMaxSpeed === -Infinity ? '—' : globalMaxSpeed.toFixed(2)}</td>
                <td className="px-3 py-3 text-center border border-slate-300">
                  <span className="inline-block px-4 py-1 bg-blue-700 text-white rounded-full text-[12px] font-black shadow">{totalAvgSpd.toFixed(2)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      </>}



    </div>
  );
}






function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="modern-card p-6 group">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2.5 bg-slate-50 rounded-xl group-hover:bg-slate-100 transition-colors">
          {icon}
        </div>
        <div className="h-1 w-10 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 w-1/3 group-hover:w-full transition-all duration-700" />
        </div>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-900 block mb-1">{title}</span>
      <div className="text-xl font-bold text-black truncate" title={value}>
        {value || "---"}
      </div>
    </div>
  );
}

function EditSplitView({ 
  result, 
  onClose, 
  onSave,
  embedded = false,
  githubCreds,
  userApiKey,
  onExtract,
}: { 
  result: ExtractionResult; 
  onClose: () => void; 
  onSave: (res: ExtractionResult) => void;
  embedded?: boolean;
  githubCreds?: { token: string; username: string; repo: string } | null;
  userApiKey?: string;
  onExtract?: (images: { base64: string; mimeType: string }[]) => Promise<Omit<ExtractionResult, 'id' | 'timestamp'>>;
}) {
  const [data, setData] = useState<ExtractionResult>(result);
  // Ref luôn giữ data mới nhất — tránh stale closure khi onSave gọi từ button
  const dataRef = React.useRef<ExtractionResult>(data);
  React.useEffect(() => { dataRef.current = data; }, [data]);

  // ── Reset data khi chuyển sang file khác (result.id thay đổi) ──
  React.useEffect(() => {
    setData(result);
    dataRef.current = result;
  }, [result.id]);

  // ── AUTO-SYNC (embedded mode): mỗi khi data thay đổi → push ngay ra pendingResults ──
  // Đảm bảo "Lưu tất cả" luôn lấy data đã chỉnh sửa dù user chưa bấm "Lưu thay đổi"
  const onSaveRef = React.useRef(onSave);
  React.useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  React.useEffect(() => {
    if (!embedded) return;
    // Debounce 400ms để tránh gọi liên tục khi đang gõ
    const timer = setTimeout(() => {
      onSaveRef.current(dataRef.current);
    }, 400);
    return () => clearTimeout(timer);
  }, [data, embedded]);
  const [zoom, setZoom] = useState(1);
  const [isFetchingImage, setIsFetchingImage] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanStatus, setRescanStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isReplacingFile, setIsReplacingFile] = useState(false);

  // ── Bảng tra cứu soilClass theo layerDesign: ưu tiên class đã được phân định ──
  const layerDesignSoilMap = React.useMemo(() => {
    const map = new Map<string, string>();
    (data.layers || []).forEach(l => {
      const key = (l.layerDesign || '').trim();
      if (!key) return;
      const sc = SOIL_CLASSES.includes((l.soilClass || '').trim()) ? l.soilClass.trim() : 'Chưa Phân định nhóm';
      const existing = map.get(key);
      // Ưu tiên class đã phân định (khác Chưa Phân định nhóm)
      if (!existing || existing === 'Chưa Phân định nhóm') {
        map.set(key, sc);
      }
    });
    return map;
  }, [data.layers]);

  // ── Thay thế File: upload PDF mới → thay trên GitHub → quét lại AI → cập nhật data ──
  const replaceFile = async () => {
    if (!githubCreds) {
      alert('❌ Chưa kết nối GitHub. Vui lòng cấu hình GitHub trước.');
      return;
    }
    // Mở hộp chọn file
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png';
    input.onchange = async (e: any) => {
      const file: File = e.target.files?.[0];
      if (!file) return;
      setIsReplacingFile(true);
      setRescanStatus('idle');
      try {
        // Đọc file thành base64
        const readBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(f);
        });
        const base64DataUrl = await readBase64(file);
        const base64Content = base64DataUrl.split(',')[1];

        // Upload file MỚI với tên mới (timestamp + tên file) — tránh cache của GitHub raw CDN
        // Sau đó xóa file cũ để dọn dẹp repo
        const { token, username, repo } = githubCreds;
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        // Luôn tạo path MỚI để tránh GitHub/CDN cache file cũ
        const newPath = `SGC-CKN/${timestamp}_${safeFileName}`;
        const oldFileUrl = data.fileUrl || null;

        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${newPath}`;
        const headers = {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        };

        console.log('[replaceFile] Uploading NEW file to path:', newPath);
        const putRes = await fetch(apiUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `Replace file: ${safeFileName} via SGC-CKN Web`,
            content: base64Content,
          }),
        });

        let newFileUrl = oldFileUrl;
        if (putRes.ok) {
          newFileUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/${newPath}`;
          console.log('[replaceFile] GitHub upload SUCCESS. New URL:', newFileUrl);

          // Cập nhật fileUrl và fileName mới lên Supabase
          try {
            if (supabase) {
              const { error: sbUpdateErr } = await supabase
                .from('drill_extractions')
                .update({ fileUrl: newFileUrl, fileName: file.name })
                .eq('id', data.id);
              if (sbUpdateErr) {
                console.error('[replaceFile] Supabase fileUrl update FAILED:', sbUpdateErr.message);
              } else {
                console.log('[replaceFile] Supabase fileUrl updated OK:', newFileUrl);
              }
            }
          } catch (sbErr) {
            console.warn('[replaceFile] Không thể cập nhật fileUrl lên Supabase:', sbErr);
          }

          // Xóa file cũ trên GitHub — chạy đồng bộ để đảm bảo dọn sạch
          if (oldFileUrl && oldFileUrl !== newFileUrl) {
            console.log('[replaceFile] Deleting old file:', oldFileUrl);
            try {
              const cleanOldUrl = decodeURIComponent(oldFileUrl.split('?')[0]);
              const oldMatch = cleanOldUrl.match(/raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/[^\/]+\/(.+)/);
              if (oldMatch) {
                const oldPath = oldMatch[1];
                const oldApiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${encodeURIComponent(oldPath).replace(/%2F/g,'/')}`;
                const oldGetRes = await fetch(`${oldApiUrl}?t=${timestamp}`, { headers });
                if (oldGetRes.ok) {
                  const oldFileData = await oldGetRes.json();
                  const delRes = await fetch(oldApiUrl, {
                    method: 'DELETE',
                    headers,
                    body: JSON.stringify({
                      message: `[SGC-CKN] Thay thế file cũ: ${oldPath.split('/').pop()} → ${safeFileName}`,
                      sha: oldFileData.sha,
                    }),
                  });
                  if (delRes.ok) {
                    console.log('[replaceFile] ✓ Old file deleted:', oldPath);
                  } else {
                    const delErr = await delRes.json().catch(()=>({}));
                    console.error('[replaceFile] ✗ Delete failed:', delErr.message || delRes.status);
                  }
                } else {
                  console.warn('[replaceFile] Old file not found on GitHub (may already be deleted):', oldPath);
                }
              } else {
                console.warn('[replaceFile] Cannot parse old file path from URL:', oldFileUrl);
              }
            } catch (delErr) {
              console.warn('[replaceFile] Lỗi khi xóa file cũ:', delErr);
            }
          } else if (!oldFileUrl) {
            console.log('[replaceFile] No old fileUrl to delete.');
          }
        } else {
          const errBody = await putRes.json().catch(() => ({}));
          console.error('[replaceFile] GitHub upload FAILED:', putRes.status, errBody);
          alert(`⚠️ Lỗi upload GitHub (${putRes.status}): ${errBody.message || 'Không thể upload'}. Vẫn tiếp tục quét AI với file mới.`);
        }

        // Cập nhật _base64 và fileUrl trong data để quét lại
        setData(prev => ({
          ...prev,
          _base64: base64DataUrl,
          _mimeType: file.type,
          fileName: file.name,
          fileUrl: newFileUrl || prev.fileUrl,
        }));

        // Quét lại AI ngay với file mới (truyền base64 trực tiếp)
        setIsReplacingFile(false);
        setIsRescanning(true);
        try {
          const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
          let imgBase64: string;
          let imgMime = 'image/jpeg';
          if (isPdf) {
            const converted = await convertPdfToImage(base64DataUrl);
            imgBase64 = converted.split(',')[1];
          } else {
            imgBase64 = base64Content;
            imgMime = file.type || 'image/jpeg';
          }

          // Chuẩn hóa ảnh
          const normalized = await new Promise<{base64: string, mime: string}>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX = 3000;
              let w = img.width, h = img.height;
              if (w > MAX || h > MAX) { if (w > h) { h *= MAX/w; w = MAX; } else { w *= MAX/h; h = MAX; } }
              canvas.width = w; canvas.height = h;
              const ctx = canvas.getContext('2d')!;
              ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
              resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
            };
            img.onerror = () => reject(new Error('Không thể tải ảnh'));
            img.src = `data:${imgMime};base64,${imgBase64}`;
          });

          const rawResult = onExtract
            ? await onExtract([{ base64: `data:image/jpeg;base64,${normalized.base64}`, mimeType: normalized.mime }])
            : await extractDataFromFile([{ base64: `data:image/jpeg;base64,${normalized.base64}`, mimeType: normalized.mime }], userApiKey);
          const map = rawResult.designLayerMap || {};
          const normalizedLayers = (rawResult.layers || []).map((layer: any) => {
            const geoCode = (layer.actualGeology || '').trim();
            const currentDesign = (layer.layerDesign || '').trim();
            if (geoCode && map[geoCode] && (!currentDesign || currentDesign.length < 5)) {
              return sanitizeLayer({ ...layer, layerDesign: stripLayerPrefix(map[geoCode]) });
            }
            return sanitizeLayer({ ...layer, layerDesign: stripLayerPrefix(layer.layerDesign || '') });
          });

          setData(prev => ({
            ...rawResult,
            layers: normalizedLayers,
            id: prev.id,
            timestamp: prev.timestamp,
            fileUrl: newFileUrl || prev.fileUrl,
            excelUrl: prev.excelUrl,
            fileName: file.name,
            _base64: base64DataUrl,
            _mimeType: file.type,
          }));
          setRescanStatus('success');
        } catch (err: any) {
          alert('❌ Lỗi quét AI: ' + (err?.message || String(err)));
          setRescanStatus('error');
        } finally {
          setIsRescanning(false);
        }
      } catch (err: any) {
        alert('❌ Lỗi thay thế file: ' + (err?.message || String(err)));
        setIsReplacingFile(false);
      }
    };
    // Phải append vào DOM để onchange hoạt động ổn định trên mọi browser
    document.body.appendChild(input);
    input.click();
    // Tự dọn sau khi chọn xong (hoặc hủy)
    setTimeout(() => {
      if (document.body.contains(input)) document.body.removeChild(input);
    }, 60000);
  };

  // ── Quét lại toàn bộ dữ liệu bằng AI từ ảnh biên bản ──
  const rescanWithAI = async (apiKey?: string) => {
    setIsRescanning(true);
    setRescanStatus('idle');
    try {
      // Bước 1: Lấy ảnh (từ _base64 cache hoặc GitHub)
      const img = await fetchImageFromGitHub();
      if (!img) {
        alert('❌ Không tìm thấy ảnh biên bản để quét lại. Vui lòng kiểm tra kết nối GitHub.');
        setRescanStatus('error');
        return;
      }

      // Bước 2: Chuẩn hóa ảnh qua Canvas (Làm sạch metadata, đảm bảo định dạng JPEG chuẩn)
      const normalizeImage = (base64: string, ext: string): Promise<{base64: string, mime: string}> => {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            // Giới hạn kích thước tối đa để tránh lỗi API (Gemini thích ảnh rõ nhưng không quá khổng lồ)
            const MAX_DIM = 3000;
            let width = image.width;
            let height = image.height;
            if (width > MAX_DIM || height > MAX_DIM) {
              if (width > height) {
                height *= MAX_DIM / width;
                width = MAX_DIM;
              } else {
                width *= MAX_DIM / height;
                height = MAX_DIM;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error("Không thể tạo canvas context"));
              return;
            }
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            // Xuất ra JPEG chất lượng cao (0.9) để AI đọc rõ chữ
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            resolve({
              base64: dataUrl.split(',')[1],
              mime: 'image/jpeg'
            });
          };
          image.onerror = () => reject(new Error("Không thể tải dữ liệu hình ảnh"));
          image.src = `data:image/${ext};base64,${base64}`;
        });
      };

      const normalized = await normalizeImage(img.base64, img.ext);

      // Bước 3: Gọi AI trích xuất lại với ảnh đã chuẩn hóa
      const rawResult = onExtract
        ? await onExtract([{ base64: `data:image/jpeg;base64,${normalized.base64}`, mimeType: normalized.mime }])
        : await extractDataFromFile([{ base64: `data:image/jpeg;base64,${normalized.base64}`, mimeType: normalized.mime }], apiKey);

      // Tự động tra cứu (VLOOKUP) mô tả địa chất dựa trên mã địa chất thực tế
      const map = rawResult.designLayerMap || {};
      const normalizedLayers = (rawResult.layers || []).map(layer => {
        const geoCode = (layer.actualGeology || '').trim();
        const currentDesign = (layer.layerDesign || '').trim();
        
        if (geoCode && map[geoCode]) {
          if (!currentDesign || currentDesign.length < 5 || currentDesign !== map[geoCode]) {
            return sanitizeLayer({ ...layer, layerDesign: stripLayerPrefix(map[geoCode]) });
          }
        }
        return sanitizeLayer({ ...layer, layerDesign: stripLayerPrefix(layer.layerDesign || '') });
      });

      // Bước 4: Merge kết quả mới vào data hiện tại
      setData(prev => ({
        ...rawResult,
        layers: normalizedLayers,
        id: prev.id,
        timestamp: prev.timestamp,
        fileUrl: prev.fileUrl,
        excelUrl: prev.excelUrl,
        fileName: prev.fileName,
        _base64: prev._base64,
        _mimeType: prev._mimeType,
      }));
      setRescanStatus('success');
    } catch (err: any) {
      console.error('rescanWithAI error:', err);
      // Trích xuất thông báo lỗi chi tiết nếu có
      let msg = err?.message || String(err);
      if (typeof err === 'object' && err !== null && 'error' in err) {
        msg = JSON.stringify(err.error);
      }
      alert('❌ Lỗi quét lại AI: ' + msg);
      setRescanStatus('error');
    } finally {
      setIsRescanning(false);
    }
  };

  // Tự động lấy ảnh từ GitHub Contents API (hỗ trợ CORS)
  const fetchImageFromGitHub = async (): Promise<{ base64: string; ext: string } | null> => {
    try {
      // 1. Ưu tiên dùng _base64 nếu có (đối với file mới upload chưa lưu hoặc còn cache)
      if (data._base64) {
        const parts = data._base64.split(',');
        if (parts.length > 1) {
          const mime = data._mimeType || '';
          const isPdf = mime === 'application/pdf' || data.fileName?.toLowerCase().endsWith('.pdf');
          
          if (isPdf && !mime.startsWith('image/')) {
            // Nếu là PDF thực sự (chưa được convert thành image/jpeg ở handleFileUpload)
            try {
              const imgBase64 = await convertPdfToImage(data._base64);
              return { base64: imgBase64.split(',')[1], ext: 'jpeg' };
            } catch (e) {
              console.error("Failed to convert cached PDF:", e);
            }
          } else {
            // Nếu là ảnh (hoặc PDF đã convert thành image/jpeg ở handleFileUpload)
            const ext = mime.includes('png') ? 'png' : 'jpeg';
            return { base64: parts[1], ext };
          }
        }
      }

      const url = data.fileUrl;
      if (!url) return null;

      // Chuẩn hoá URL về dạng raw.githubusercontent.com
      let rawUrl = url;
      if (url.includes('github.com') && url.includes('/blob/')) {
        rawUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }

      const cleanUrl = rawUrl.split('?')[0].toLowerCase();
      const isPdf = cleanUrl.endsWith('.pdf') || url.includes('application/pdf');
      const ext = isPdf ? 'jpeg' : (cleanUrl.endsWith('.png') ? 'png' : 'jpeg');

      // Helper: ArrayBuffer → base64 (Sử dụng FileReader để xử lý an toàn với tệp lớn)
      const toBase64 = (buf: ArrayBuffer): Promise<string> => {
        return new Promise((resolve, reject) => {
          const blob = new Blob([buf]);
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64String = reader.result as string;
            // Loại bỏ prefix data:application/octet-stream;base64,
            resolve(base64String.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };

      // Helper: Xử lý buffer (nếu là PDF thì convert sang ảnh)
      const processBuffer = async (buf: ArrayBuffer): Promise<{ base64: string; ext: string }> => {
        if (isPdf) {
          try {
            console.log("Đang chuyển đổi PDF từ GitHub sang ảnh để nhúng Excel...");
            const imgBase64 = await convertPdfToImage(buf);
            return { base64: imgBase64.split(',')[1], ext: 'jpeg' };
          } catch (e) {
            console.error("Lỗi chuyển đổi PDF sang ảnh từ buffer:", e);
            // Nếu lỗi convert, trả về null để Excel vẫn xuất được data (không có ảnh)
            throw e; 
          }
        }
        const base64 = await toBase64(buf);
        return { base64, ext };
      };

      // ── Chiến lược 1: Cloudflare Proxy (đọc GITHUB_TOKEN từ server, không CORS) ──
      try {
        const proxyResp = await fetch(`/api/proxy-image?url=${encodeURIComponent(rawUrl)}`);
        if (proxyResp.ok) {
          const buf = await proxyResp.arrayBuffer();
          if (buf.byteLength > 100) return await processBuffer(buf);
        }
      } catch { /* thử cách khác */ }

      // ── Chiến lược 2: Fetch thẳng raw URL với token client (public repo) ──
      try {
        const headers: Record<string, string> = {};
        if (githubCreds?.token) headers['Authorization'] = `token ${githubCreds.token}`;
        const directResp = await fetch(rawUrl, { headers, cache: 'no-store' });
        if (directResp.ok) {
          const buf = await directResp.arrayBuffer();
          if (buf.byteLength > 100) return await processBuffer(buf);
        }
      } catch { /* thử cách khác */ }

      // ── Chiến lược 3: GitHub Contents API (Accept: raw) ──
      const m = rawUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
      if (m) {
        const [, owner, repo, branch, filePath] = m;
        const token = githubCreds?.token;
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3.raw' };
        if (token) headers['Authorization'] = `token ${token}`;
        try {
          const apiResp = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
            { headers }
          );
          if (apiResp.ok) {
            const buf = await apiResp.arrayBuffer();
            if (buf.byteLength > 100) return await processBuffer(buf);
          }
        } catch { /* thất bại */ }
      }

      return null;
    } catch { return null; }
  };


    const exportToExcel = (result: ExtractionResult, imageData?: { base64: string; ext: string } | null) => {
    // Helper màu ExcelJS
    const argb = (hex: string) => 'FF' + hex.toUpperCase();
    const thinBorder = (color = 'CCCCCC') => ({
      top: { style: 'thin' as const, color: { argb: argb(color) } },
      bottom: { style: 'thin' as const, color: { argb: argb(color) } },
      left: { style: 'thin' as const, color: { argb: argb(color) } },
      right: { style: 'thin' as const, color: { argb: argb(color) } },
    });

    const applyCell = (cell: any, value: any, opts: { bg?: string; fontColor?: string; bold?: boolean; sz?: number; align?: string; wrap?: boolean; border?: any }) => {
      cell.value = value;
      cell.font = { name: 'Arial', size: opts.sz ?? 10, bold: opts.bold ?? false, color: { argb: argb(opts.fontColor ?? '000000') } };
      if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(opts.bg) } };
      cell.alignment = { horizontal: (opts.align ?? 'center') as any, vertical: 'middle', wrapText: opts.wrap ?? false };
      cell.border = opts.border ?? thinBorder();
    };

    loadExcelJS().then(async (ExcelJS) => {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'SGC-CKN'; wb.created = new Date();

      // Tính groupColor index
      let gc = 0; let pk = '';
      const rowColorIdx = result.layers.map((layer) => {
        const key = layer.layerDesign?.trim() || '__';
        if (key !== pk) { gc++; pk = key; }
        return Math.max(0, gc - 1) % GROUP_COLORS.length;
      });

      // ════════════════════════════════════════
      // SHEET 1: Chi tiết địa chất
      // ════════════════════════════════════════
      const ws1 = wb.addWorksheet('Chi tiết địa chất');

      // Cột widths (characters)
      ws1.columns = [
        { width: 14 }, { width: 11 }, { width: 46 }, { width: 13 }, { width: 13 },
        { width: 11 }, { width: 11 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 28 },
      ];

      // Block thông tin
      const infoItems = [
        ['Dự án', result.project], ['Hạng mục', result.item],
        ['Tên bộ phận', result.componentName], ['Số hiệu cọc', result.pileId],
        ['Tên Máy khoan', result.reportNumber], ['Đường kính', result.diameter],
        ['Bắt đầu thi công', result.constructionStart], ['Kết thúc thi công', result.constructionEnd],
      ];
      infoItems.forEach(([k, v]) => {
        const row = ws1.addRow([k, v]);
        row.height = 18;
        applyCell(row.getCell(1), k, { bg: 'EFF6FF', fontColor: '1E3A6E', bold: true, align: 'left', border: thinBorder('DBEAFE') });
        applyCell(row.getCell(2), v, { bg: 'FFFFFF', fontColor: '374151', align: 'left', border: thinBorder('DBEAFE') });
        // Merge B-K cho value
        ws1.mergeCells(row.number, 2, row.number, 11);
      });

      // Dòng trống
      const blankRow = ws1.addRow([]);
      blankRow.height = 6;

      // Header bảng
      const hdrCols = ['Địa chất TT', 'Đường kính', 'Mô tả lớp thiết kế', 'Từ (h)', 'Đến (h)', 'Cao độ từ', 'Cao độ đến', 'T.Gian (h)', 'Dài (m)', 'V (m/h)', 'Ghi chú'];
      const hdrRow = ws1.addRow(hdrCols);
      hdrRow.height = 36;
      hdrCols.forEach((h, ci) => {
        applyCell(hdrRow.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 || ci === 10 ? 'left' : 'center', wrap: true, border: thinBorder('FFFFFF') });
      });

      // Dữ liệu các lớp
      result.layers.forEach((layer, ri) => {
        const { bg, font: fontColor } = GROUP_COLORS[rowColorIdx[ri]];
        const spd = layer.speedMph;
        const isSlowSpd = spd > 0 && spd <= 1;
        const spdBg = isSlowSpd ? 'DC2626' : spd > 5 ? 'D1FAE5' : 'FFF7ED';
        const spdFontColor = isSlowSpd ? 'FFFFFF' : 'C2410C';

        const vals = [
          getGeoDisplay(layer), result.diameter, layer.layerDesign,
          layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
          layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
          layer.elevationFrom, layer.elevationTo,
          parseFloat(toNum(layer.durationHours).toFixed(2)),
          parseFloat(toNum(layer.lengthMeters).toFixed(2)),
          parseFloat(spd.toFixed(2)),
          layer.notes || '',
        ];
        const dataRow = ws1.addRow(vals);
        dataRow.height = 36;
        vals.forEach((v, ci) => {
          const isSpd = ci === 9;
          applyCell(dataRow.getCell(ci + 1), v, {
            bg: isSpd ? spdBg : bg,
            fontColor: isSpd ? spdFontColor : fontColor,
            bold: isSpd && isSlowSpd,
            align: ci === 2 || ci === 10 ? 'left' : 'center',
            wrap: ci === 2 || ci === 3 || ci === 4 || ci === 10,
            border: thinBorder(),
          });
        });
      });

      // Nhúng ảnh biên bản (nếu là ảnh, không phải PDF)
      if (imageData) {
        const imgData = imageData;
        if (imgData) {
          const imgId = wb.addImage({ base64: imgData.base64, extension: imgData.ext as any });
          const startRow = 11 + result.layers.length + 2; // sau bảng data
          // Thêm tiêu đề ảnh
          const titleRow = ws1.getRow(startRow);
          titleRow.height = 25;
          applyCell(titleRow.getCell(1), 'ẢNH BIÊN BẢN GỐC', { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 12, align: 'center', border: thinBorder('1A3A6B') });
          ws1.mergeCells(startRow, 1, startRow, 11);

          // Nhúng ảnh vào dòng ngay sau tiêu đề
          // tl.row là 0-indexed, startRow là 1-indexed (dòng tiêu đề).
          // Vậy tl.row = startRow đặt ảnh bắt đầu từ dòng ngay sau tiêu đề.
          ws1.addImage(imgId, {
            tl: { col: 0, row: startRow }, 
            ext: { width: 850, height: 1100 }, 
          });

          // Giãn các dòng để chứa ảnh (~1100px)
          for (let i = startRow + 1; i <= startRow + 60; i++) {
            ws1.getRow(i).height = 20;
          }
        }
      }

      // ════════════════════════════════════════
      // SHEET 2: Tổng hợp lớp thiết kế
      // ════════════════════════════════════════
      const ws2 = wb.addWorksheet('Tổng hợp lớp thiết kế');
      ws2.columns = [
        { width: 6 }, { width: 11 }, { width: 46 }, { width: 10 },
        { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 12 },
      ];

      const hdr2 = ['STT', 'Đường kính', 'Lớp Thiết Kế', 'Số đoạn', 'Cao độ từ (m)', 'Cao độ đến (m)', 'Tổng T.Gian (h)', 'Tổng Dài (m)', 'V TB (m/h)'];
      const hdrRow2 = ws2.addRow(hdr2);
      hdrRow2.height = 36;
      hdr2.forEach((h, ci) => {
        applyCell(hdrRow2.getCell(ci + 1), h, { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 11, align: ci === 2 ? 'left' : 'center', wrap: true, border: thinBorder('FFFFFF') });
      });

      // Tính groups
      const groups: any[] = [];
      let gc2 = 0; let pk2 = '';
      result.layers.forEach((layer) => {
        const key = layer.layerDesign?.trim() || '(Chưa có)';
        if (key !== pk2) { gc2++; pk2 = key; }
        const ci2 = Math.max(0, gc2 - 1) % GROUP_COLORS.length;
        const last = groups[groups.length - 1];
        if (last && last.layerDesign === key) {
          last.segments++; last.elevationTo = layer.elevationTo;
          last.totalDuration += layer.durationHours; last.totalLength += layer.lengthMeters;
        } else {
          groups.push({ layerDesign: key, segments: 1, elevationFrom: layer.elevationFrom, elevationTo: layer.elevationTo, totalDuration: layer.durationHours, totalLength: layer.lengthMeters, colorIdx: ci2 });
        }
      });
      groups.forEach(g => { g.avgSpeed = g.totalDuration > 0 ? g.totalLength / g.totalDuration : 0; });
      const totalDur = groups.reduce((s, g) => s + g.totalDuration, 0);
      const totalLen2 = groups.reduce((s, g) => s + g.totalLength, 0);
      const totalAvgSpd = totalDur > 0 ? totalLen2 / totalDur : 0;

      groups.forEach((g, i) => {
        const { bg, font: fontColor } = GROUP_COLORS[g.colorIdx];
        const isSlowSpd = g.avgSpeed > 0 && g.avgSpeed <= 1;
        const spdBg = isSlowSpd ? 'DC2626' : g.avgSpeed > 5 ? 'D1FAE5' : 'FFF7ED';
        const vals2 = [i + 1, result.diameter, g.layerDesign, g.segments, parseFloat(toNum(g.elevationFrom).toFixed(2)), parseFloat(toNum(g.elevationTo).toFixed(2)), parseFloat(g.totalDuration.toFixed(2)), parseFloat(g.totalLength.toFixed(2)), parseFloat(g.avgSpeed.toFixed(2))];
        const r2 = ws2.addRow(vals2);
        r2.height = 32;
        vals2.forEach((v, ci) => {
          const isSpd = ci === 8;
          applyCell(r2.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? (isSlowSpd ? 'FFFFFF' : 'C2410C') : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 ? 'left' : 'center', wrap: ci === 2, border: thinBorder() });
        });
      });

      // Dòng tổng
      const totVals = ['TỔNG CỘNG', '', '', result.layers.length,
        result.layers.length > 0 ? parseFloat(toNum(result.layers[0].elevationFrom).toFixed(2)) : '',
        result.layers.length > 0 ? parseFloat(toNum(result.layers[result.layers.length - 1].elevationTo).toFixed(2)) : '',
        parseFloat(totalDur.toFixed(2)), parseFloat(totalLen2.toFixed(2)), parseFloat(totalAvgSpd.toFixed(2))];
      const totRow = ws2.addRow(totVals);
      totRow.height = 28;
      totVals.forEach((v, ci) => {
        applyCell(totRow.getCell(ci + 1), v, { bg: 'E2E8F0', fontColor: '1E3A6E', bold: true, sz: 11, align: ci === 0 ? 'left' : 'center', border: { ...thinBorder(), top: { style: 'medium' as const, color: { argb: argb('1E3A6E') } } } });
      });

      // Xuất file
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Tên file chuẩn dùng chung buildExcelFileName
      a.download = `${buildExcelFileName(result)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch((err) => { console.error(err); alert('Không thể tải thư viện xuất Excel. Vui lòng kiểm tra kết nối mạng.'); });
  };

  const [displayUrl, setDisplayUrl] = useState<string | null>(result.fileUrl || null);
  const [isPdf, setIsPdf] = useState(false);
  // Dialog upload thủ công đã bị loại bỏ — ảnh luôn tự động lấy từ GitHub
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const PDF_RENDER_WIDTH = 2400;
  const PDF_DISPLAY_WIDTH = 600;

  // Global mouse events để pan không bị mất khi kéo ra ngoài container
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newPos = { 
        x: e.clientX - dragStartRef.current.x, 
        y: e.clientY - dragStartRef.current.y 
      };
      positionRef.current = newPos;
      setPosition(newPos);
    };
    const onUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ESC để đóng khi là full-screen modal (không phải embedded)
  useEffect(() => {
    if (embedded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [embedded, onClose]);

  // Helper: chuyển GitHub download_url hoặc API URL sang raw URL để tránh CORS
  const toRawGithubUrl = (url: string): string => {
    if (!url) return url;
    if (url.includes('raw.githubusercontent.com')) return url;
    const apiMatch = url.match(/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/contents\/(.+?)(\?|$)/);
    if (apiMatch) return `https://raw.githubusercontent.com/${apiMatch[1]}/${apiMatch[2]}/main/${apiMatch[3]}`;
    const blobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
    if (blobMatch) return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${blobMatch[4]}`;
    return url;
  };

  useEffect(() => {
    async function loadFile() {
      if (!data.fileUrl) {
        if (data._base64) {
          setDisplayUrl(data._base64);
          // Nếu là PDF chưa convert (trường hợp cũ) thì vẫn hiện PDF, 
          // nhưng với logic mới PDF đã thành image/jpeg
          setIsPdf(data._mimeType === 'application/pdf');
        } else {
          setDisplayUrl(null);
        }
        setLoadError(null);
        return;
      }

      const url = data.fileUrl;
      const cleanUrl = url.split('?')[0].toLowerCase();
      const isPdfFile = cleanUrl.endsWith('.pdf') || url.includes('mimeType=application/pdf');
      
      setIsPdf(isPdfFile);
      setLoadError(null);
      setIsLoading(true);

      // Raw githubusercontent URLs có thể load trực tiếp, không cần proxy
      // Cloudflare Pages không hỗ trợ server-side proxy
      setDisplayUrl(toRawGithubUrl(url));
      setIsLoading(false);
    }

    loadFile();
  }, [data.fileUrl, data._base64, data._mimeType]);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 8));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.2));
  const handleResetZoom = () => {
    setZoom(1);
    positionRef.current = { x: 0, y: 0 };
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - positionRef.current.x, y: e.clientY - positionRef.current.y };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {};
  const handleMouseUp = () => {};

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.88 : 1.12;
    const rect = e.currentTarget.getBoundingClientRect();
    // Vị trí con trỏ tính từ center của container
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    setZoom(prev => {
      const newZoom = Math.min(Math.max(prev * scaleFactor, 0.2), 8);
      const ratio = newZoom / prev;
      const newPos = {
        x: mouseX - (mouseX - positionRef.current.x) * ratio,
        y: mouseY - (mouseY - positionRef.current.y) * ratio,
      };
      positionRef.current = newPos;
      setPosition(newPos);
      return newZoom;
    });
  };

  const recalculateLayer = (layer: DrillLayer): DrillLayer => {
    const newLayer = { ...layer };
    
    // Parse times with dates
    const startTotalMinutes = parseDateTimeToMinutes(newLayer.timeFrom, newLayer.dateFrom);
    const endTotalMinutes = parseDateTimeToMinutes(newLayer.timeTo, newLayer.dateTo);
    
    if (startTotalMinutes !== 0 && endTotalMinutes !== 0) {
      let durationMinutes = endTotalMinutes - startTotalMinutes;
      // Nếu cùng ngày mà giờ kết thúc < giờ bắt đầu, coi như qua đêm (nhưng thường đã có dateTo khác dateFrom)
      if (durationMinutes < 0 && newLayer.dateFrom === newLayer.dateTo) durationMinutes += 24 * 60;
      
      if (durationMinutes <= 0) durationMinutes = 30; 
      newLayer.durationHours = durationMinutes / 60;
    } else {
      // Fallback về logic cũ nếu thiếu ngày
      const startMinutes = parseTimeToMinutes(newLayer.timeFrom);
      const endMinutes = parseTimeToMinutes(newLayer.timeTo);
      if (startMinutes !== 0 || endMinutes !== 0) {
        let durationMinutes = endMinutes - startMinutes;
        if (durationMinutes < 0) durationMinutes += 24 * 60;
        if (durationMinutes <= 0) durationMinutes = 30; 
        newLayer.durationHours = durationMinutes / 60;
      }
    }
    
    const elevStart = parseFloat(toNum(newLayer.elevationFrom).toString().replace(',', '.'));
    const elevEnd = parseFloat(toNum(newLayer.elevationTo).toString().replace(',', '.'));
    if (!isNaN(elevStart) && !isNaN(elevEnd)) {
      newLayer.lengthMeters = Math.abs(elevEnd - elevStart);
      if (newLayer.durationHours > 0) {
        newLayer.speedMph = newLayer.lengthMeters / newLayer.durationHours;
      }
    }
    
    return newLayer;
  };

  const updateField = (field: keyof ExtractionResult, value: string) => {
    setData(prev => {
      const newData = { ...prev, [field]: value };
      
      // Đồng bộ ngày trong bảng địa chất khi thay đổi ngày bắt đầu thi công
      if (field === 'constructionStart') {
        const dateMatch = value.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
          const newDate = dateMatch[1];
          newData.layers = prev.layers.map(layer => recalculateLayer({
            ...layer,
            dateFrom: newDate,
            dateTo: newDate
          }));
        }
      }
      
      return newData;
    });
  };

  const updateLayer = (idx: number, field: keyof DrillLayer, value: any) => {
    const newLayers = [...data.layers];
    newLayers[idx] = { ...newLayers[idx], [field]: value };
    
    // Tự động tra cứu (VLOOKUP) mô tả địa chất khi thay đổi mã địa chất thực tế
    if (field === 'actualGeology') {
      const val = value.toString().trim();
      // Chấp nhận cả dạng "1" hoặc "1 (2)"
      const match = val.match(/^(\d+)/);
      if (match) {
        const code = match[1];
        newLayers[idx].designLayerCode = code;
        // Cập nhật mô tả từ designLayerMap nếu có
        const designMap = data.designLayerMap || {};
        if (designMap[code]) {
          newLayers[idx].layerDesign = designMap[code];
        }
      }
    }
    
    // Recalculate duration and speed if times or dates change
    if (['timeFrom', 'timeTo', 'dateFrom', 'dateTo'].includes(field as string)) {
      newLayers[idx] = recalculateLayer(newLayers[idx]);
    }

    // Logic: Khi sửa chiều dài (lengthMeters) hoặc cao độ (elevationFrom, elevationTo)
    if (['lengthMeters', 'elevationFrom', 'elevationTo'].includes(field as string)) {
      const currentLayer = newLayers[idx];
      const elevFrom = parseFloat(toNum(currentLayer.elevationFrom).toString().replace(',', '.'));
      const elevTo = parseFloat(toNum(currentLayer.elevationTo).toString().replace(',', '.'));
      const len = parseFloat(toNum(currentLayer.lengthMeters).toString().replace(',', '.'));

      if (field === 'lengthMeters') {
        if (!isNaN(elevFrom) && !isNaN(len)) {
          newLayers[idx].elevationTo = elevFrom - len;
        }
      } else if (field === 'elevationTo') {
        if (!isNaN(elevFrom) && !isNaN(elevTo)) {
          newLayers[idx].lengthMeters = Math.abs(elevFrom - elevTo);
        }
      } else if (field === 'elevationFrom') {
        if (!isNaN(elevFrom) && !isNaN(len)) {
          newLayers[idx].elevationTo = elevFrom - len;
        }
      }

      // Đảm bảo tính lại speed cho lớp hiện tại
      newLayers[idx] = recalculateLayer(newLayers[idx]);

      // Cập nhật toàn bộ các lớp phía dưới để đồng bộ cao độ
      for (let i = idx + 1; i < newLayers.length; i++) {
        const prevLayer = newLayers[i - 1];
        const prevElevTo = parseFloat(toNum(prevLayer.elevationTo).toString().replace(',', '.'));
        
        if (!isNaN(prevElevTo)) {
          newLayers[i].elevationFrom = prevElevTo;
          const currentLen = parseFloat(toNum(newLayers[i].lengthMeters).toString().replace(',', '.'));
          if (!isNaN(currentLen)) {
            newLayers[i].elevationTo = newLayers[i].elevationFrom - currentLen;
          }
          // Tính lại speed cho lớp này
          newLayers[i] = recalculateLayer(newLayers[i]);
        }
      }
    }
    
    setData(prev => ({ ...prev, layers: newLayers }));
  };

  const addLayer = () => {
    const lastLayer = data.layers[data.layers.length - 1];
    const newLayer: DrillLayer = {
      ...lastLayer,
      layerNumber: data.layers.length + 1,
      timeFrom: lastLayer?.timeTo || '00:00',
      timeTo: lastLayer?.timeTo || '00:00',
      elevationFrom: lastLayer?.elevationTo || 0,
      elevationTo: lastLayer?.elevationTo || 0,
      durationHours: 0,
      lengthMeters: 0,
      speedMph: 0
    };
    setData(prev => ({ ...prev, layers: [...prev.layers, newLayer] }));
  };

  // Thêm dòng mới SAU vị trí idx
  const addLayerAt = (idx: number) => {
    const refLayer = data.layers[idx];
    const newLayer: DrillLayer = {
      ...refLayer,
      layerNumber: idx + 2,
      timeFrom: refLayer?.timeTo || '00:00',
      timeTo: refLayer?.timeTo || '00:00',
      elevationFrom: refLayer?.elevationTo || 0,
      elevationTo: refLayer?.elevationTo || 0,
      durationHours: 0,
      lengthMeters: 0,
      speedMph: 0,
      notes: '',
    };
    const newLayers = [
      ...data.layers.slice(0, idx + 1),
      newLayer,
      ...data.layers.slice(idx + 1),
    ].map((l, i) => ({ ...l, layerNumber: i + 1, designLayerCode: String(i + 1) }));
    setData(prev => ({ ...prev, layers: newLayers }));
  };

  const removeLayer = (idx: number) => {
    if (data.layers.length <= 1) return;
    const newLayers = data.layers.filter((_, i) => i !== idx).map((l, i) => ({ ...l, layerNumber: i + 1, designLayerCode: String(i + 1) }));
    setData(prev => ({ ...prev, layers: newLayers }));
  };

  // Di chuyển dòng lên/xuống
  const moveLayer = (idx: number, direction: 'up' | 'down') => {
    const newLayers = [...data.layers];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newLayers.length) return;
    [newLayers[idx], newLayers[targetIdx]] = [newLayers[targetIdx], newLayers[idx]];
    const reindexed = newLayers.map((l, i) => ({ ...l, layerNumber: i + 1, designLayerCode: String(i + 1) }));
    setData(prev => ({ ...prev, layers: reindexed }));
  };


  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
    positionRef.current = { x: 0, y: 0 };
    setPosition({ x: 0, y: 0 });
    setZoom(PDF_DISPLAY_WIDTH / PDF_RENDER_WIDTH);
  };

  return (
    <div className={embedded ? "flex flex-col h-full" : "fixed inset-0 bg-white z-[200] flex flex-col animate-in fade-in duration-300"}>
      {/* Header - chỉ hiện khi không embedded (vì embedded có header riêng ở cột phải) */}
      {!embedded && (
      <div className="h-16 bg-blue-900 border-b border-blue-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-white/20 p-2 rounded-lg text-white">
            <Edit2 size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">CHI TIẾT BIÊN BẢN</h3>
            <p className="text-sm text-blue-100 font-bold uppercase tracking-widest">{data.project}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Nút Thay thế File */}
          <button
            disabled={isReplacingFile || isRescanning}
            onClick={replaceFile}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border flex items-center gap-2 ${
              isReplacingFile || isRescanning
                ? 'bg-purple-300 border-purple-200 text-white cursor-wait'
                : rescanStatus === 'success'
                ? 'bg-emerald-500 border-emerald-400 text-white hover:bg-emerald-600'
                : 'bg-purple-500 border-purple-400 text-white hover:bg-purple-600'
            }`}
            title="Upload file PDF mới để thay thế file cũ, tự động quét lại bằng AI"
          >
            {isReplacingFile ? (
              <><svg className="animate-spin" width={13} height={13} viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Đang upload...</>
            ) : isRescanning ? (
              <><svg className="animate-spin" width={13} height={13} viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Đang quét AI...</>
            ) : rescanStatus === 'success' ? (
              <><CheckCircle2 size={13} /> Đã quét xong — Kiểm tra & Lưu</>
            ) : (
              <><Upload size={13} /> Thay thế File</>
            )}
          </button>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-red-400 hover:bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors border border-red-300"
          >
            Hủy bỏ
          </button>
          <button 
            onClick={() => onSave(dataRef.current)}
            className="px-6 py-2 bg-sky-400 hover:bg-sky-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center gap-2"
          >
            <Save size={14} />
            Lưu thay đổi
          </button>
        </div>
      </div>
      )} {/* end !embedded header */}

      {/* Banner kết quả quét lại */}
      {!embedded && rescanStatus === 'success' && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 flex items-center gap-2 text-emerald-700 text-[12px] font-bold shrink-0">
          <CheckCircle2 size={14} />
          AI đã quét lại xong — Dữ liệu bên dưới đã được cập nhật. Vui lòng kiểm tra rồi bấm <span className="font-black mx-1">Lưu thay đổi</span>.
        </div>
      )}

      {/* Main Content Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Data Form - chiếm phần còn lại sau khi viewer co vừa A4 */}
        <div className="flex-1 border-r border-sky-100 bg-white overflow-y-auto p-8 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Dự án</label>
              <input 
                value={data.project} 
                onChange={(e) => updateField('project', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Hạng mục</label>
              <input 
                value={data.item} 
                onChange={(e) => updateField('item', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Tên bộ phận</label>
              <input 
                value={data.componentName} 
                onChange={(e) => updateField('componentName', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Số hiệu cọc</label>
              <input 
                value={data.pileId} 
                onChange={(e) => updateField('pileId', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Tên Máy khoan</label>
              <input 
                value={data.reportNumber} 
                onChange={(e) => updateField('reportNumber', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Đường kính</label>
              <input 
                value={data.diameter} 
                onChange={(e) => updateField('diameter', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
                placeholder="VD: D2000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Bắt đầu thi công</label>
              <input 
                value={data.constructionStart} 
                onChange={(e) => updateField('constructionStart', e.target.value)}
                onBlur={(e) => updateField('constructionStart', expandDateTime(e.target.value))}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
                placeholder="HH:mm dd/mm/yyyy"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Kết thúc thi công</label>
              <input 
                value={data.constructionEnd} 
                onChange={(e) => updateField('constructionEnd', e.target.value)}
                onBlur={(e) => updateField('constructionEnd', expandDateTime(e.target.value))}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
                placeholder="HH:mm dd/mm/yyyy"
              />
            </div>
          </div>


          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-black uppercase tracking-widest flex items-center gap-2">
                <Layers size={14} />
                Chi tiết các lớp địa chất
                <span className="text-[10px] font-bold text-slate-400 normal-case">({data.layers.length} lớp)</span>
              </h4>
              <button
                onClick={addLayer}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
              >
                <Plus size={12} /> Thêm lớp
              </button>
            </div>
            <div className="overflow-hidden border border-slate-300 rounded-xl shadow-sm bg-white">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full border-collapse table-auto">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300">
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'60px'}}>ĐỊA CHẤT <br/> THỰC TẾ</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Đường kính</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'110px'}}>Cấp đất đá</th>
                      <th className="px-2 py-2 text-left text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300" style={{minWidth:'220px'}}>Mô tả lớp thiết kế</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Từ (h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Đến (h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Cao độ từ</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Cao độ đến</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>T.Gian</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'75px'}}>Dài (m)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'75px'}}>V (m/h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'150px'}}>Ghi chú</th>
                      <th className="px-1 py-2 text-center text-[11px] font-black text-slate-500 uppercase whitespace-nowrap" style={{width:'60px'}}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(() => {
                      // Màu xen kẽ tương phản tối đa — mỗi 2 màu liền kề phải khác hẳn nhau về tông
                      const groupColors = [
                        { row: 'bg-sky-200',     text: 'text-sky-900' },
                        { row: 'bg-amber-200',   text: 'text-amber-900' },
                        { row: 'bg-emerald-200', text: 'text-emerald-900' },
                        { row: 'bg-rose-200',    text: 'text-rose-900' },
                        { row: 'bg-violet-200',  text: 'text-violet-900' },
                        { row: 'bg-lime-200',    text: 'text-lime-900' },
                        { row: 'bg-orange-200',  text: 'text-orange-900' },
                        { row: 'bg-cyan-200',    text: 'text-cyan-900' },
                        { row: 'bg-pink-200',    text: 'text-pink-900' },
                        { row: 'bg-teal-200',    text: 'text-teal-900' },
                        { row: 'bg-red-200',     text: 'text-red-900' },
                        { row: 'bg-indigo-200',  text: 'text-indigo-900' },
                      ];
                      // Nhóm theo khối liên tiếp: mỗi lần layerDesign thay đổi so với dòng trước → đổi màu
                      let groupCount = 0;
                      let prevKey = '';
                      const rowColorIdx: number[] = data.layers.map((layer) => {
                        const key = layer.layerDesign?.trim() || '__empty__';
                        if (key !== prevKey) { groupCount++; prevKey = key; }
                        return Math.max(0, groupCount - 1) % groupColors.length;
                      });
                      return data.layers.map((layer, idx) => {
                        const { row: rowBg, text: rowText } = groupColors[rowColorIdx[idx]];
                        return (
                      <tr key={idx} className={`group transition-colors hover:opacity-90`}>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`} style={{width:'60px'}}>
                          <div className="flex flex-col items-center px-1 py-1">
                            <input 
                              value={getGeoDisplay(layer)} 
                              onChange={(e) => updateLayer(idx, 'actualGeology', e.target.value)}
                              className={`w-full bg-transparent border-none text-[12px] text-blue-800 font-black focus:bg-white px-1 py-0 text-center outline-none transition-all`}
                              placeholder="..."
                            />
                          </div>
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle whitespace-nowrap ${rowBg}`}>
                          <input
                            value={data.diameter}
                            readOnly
                            className={`w-full bg-transparent border-none text-[12px] text-black font-normal px-2 py-1 text-center outline-none`}
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`} style={{width:'110px'}}>
                          <div className="flex items-center justify-center px-1 py-1">
                            {(() => {
                              const key = (layer.layerDesign || '').trim();
                              const sc = layerDesignSoilMap.get(key) || 'Chưa Phân định nhóm';
                              const colors: Record<string, string> = {
                                'Đất cấp I':   'bg-yellow-100 text-yellow-800 border-yellow-300',
                                'Đất cấp II':  'bg-emerald-100 text-emerald-800 border-emerald-300',
                                'Đất cấp III': 'bg-orange-100 text-orange-800 border-orange-300',
                                'Đá cấp I':    'bg-rose-100 text-rose-800 border-rose-300',
                                'Chưa Phân định nhóm': 'bg-slate-100 text-slate-500 border-slate-300',
                              };
                              return (
                                <span className={`inline-block px-1.5 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${colors[sc] || colors['Chưa Phân định nhóm']}`}>
                                  {sc === 'Chưa Phân định nhóm' ? 'Chưa PĐN' : sc}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`} style={{minWidth:'160px'}}>
                          <AutoResizeTextarea 
                            value={layer.layerDesign}
                            onChange={(e: any) => {
                              updateLayer(idx, 'layerDesign', e.target.value);
                            }}
                            className={`w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-2 py-1 text-left outline-none leading-normal transition-all resize-none overflow-hidden`}
                            style={{height: 'auto'}}
                          />
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`}>
                          <div className="flex flex-col items-center px-1 py-1" style={{ minWidth: '80px', width: '80px' }}>
                            <input 
                              type="text"
                              value={layer.timeFrom} 
                              onChange={(e) => updateLayer(idx, 'timeFrom', e.target.value)}
                              className="w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-1 py-0 text-center outline-none transition-all"
                              placeholder="HH:mm"
                            />
                            <input 
                              type="text"
                              value={layer.dateFrom || ''} 
                              onChange={(e) => updateLayer(idx, 'dateFrom', e.target.value)}
                              onBlur={(e) => updateLayer(idx, 'dateFrom', expandYear(e.target.value))}
                              className="w-full bg-transparent border-none text-[10px] text-slate-500 font-normal focus:bg-white px-1 py-0 text-center outline-none transition-all"
                              placeholder="dd/mm/yyyy"
                            />
                          </div>
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`}>
                          <div className="flex flex-col items-center px-1 py-1" style={{ minWidth: '80px', width: '80px' }}>
                            <input 
                              type="text"
                              value={layer.timeTo} 
                              onChange={(e) => updateLayer(idx, 'timeTo', e.target.value)}
                              className="w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-1 py-0 text-center outline-none transition-all"
                              placeholder="HH:mm"
                            />
                            <input 
                              type="text"
                              value={layer.dateTo || ''} 
                              onChange={(e) => updateLayer(idx, 'dateTo', e.target.value)}
                              onBlur={(e) => updateLayer(idx, 'dateTo', expandYear(e.target.value))}
                              className="w-full bg-transparent border-none text-[10px] text-slate-500 font-normal focus:bg-white px-1 py-0 text-center outline-none transition-all"
                              placeholder="dd/mm/yyyy"
                            />
                          </div>
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle whitespace-nowrap ${rowBg}`}>
                          <NumericCell
                            value={layer.elevationFrom}
                            onChange={(val) => updateLayer(idx, 'elevationFrom', val)}
                            className="w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-yellow-50 focus:ring-1 focus:ring-yellow-400 focus:rounded px-2 py-1 outline-none text-center transition-all cursor-text"
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle whitespace-nowrap ${rowBg}`}>
                          <NumericCell
                            value={layer.elevationTo}
                            onChange={(val) => updateLayer(idx, 'elevationTo', val)}
                            className="w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-yellow-50 focus:ring-1 focus:ring-yellow-400 focus:rounded px-2 py-1 outline-none text-center transition-all cursor-text"
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`px-2 py-1 text-[12px] font-normal text-black text-center ${rowBg} border-r border-slate-200 align-middle whitespace-nowrap`}>
                          {formatNumber(layer.durationHours)}
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle whitespace-nowrap ${rowBg}`}>
                          <NumericCell
                            value={layer.lengthMeters}
                            onChange={(val) => updateLayer(idx, 'lengthMeters', val)}
                            className="w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-yellow-50 focus:ring-1 focus:ring-yellow-400 focus:rounded px-2 py-1 outline-none text-center transition-all cursor-text"
                            style={{ minWidth: '75px', width: '75px' }}
                          />
                        </td>
                        <td className={cn(
                          "px-2 py-1 text-[12px] font-normal text-center align-middle border-r border-slate-200 whitespace-nowrap",
                          layer.speedMph <= 1 ? "bg-red-50" : "bg-white"
                        )}>
                          <span className={cn(
                            "inline-flex items-center px-1 py-0.5 rounded-full text-[12px] font-normal",
                            layer.speedMph <= 1 ? "text-white bg-red-600 font-black" : 
                            layer.speedMph > 5 ? "text-emerald-800 bg-emerald-100" : "text-orange-800 bg-orange-100"
                          )}>
                            {formatNumber(layer.speedMph)}
                          </span>
                        </td>
                        <td className={`p-0 align-middle ${rowBg}`}>
                          <AutoResizeTextarea 
                            value={layer.notes} 
                            onChange={(e: any) => {
                              updateLayer(idx, 'notes', e.target.value);
                            }}
                            className="w-full bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-2 py-1 text-center outline-none leading-normal transition-all resize-none overflow-hidden"
                            style={{height: 'auto'}}
                            placeholder="..."
                          />
                        </td>
                        {/* Cột thao tác: thêm dòng dưới + xóa */}
                        <td className="p-0 align-middle border-l border-slate-200 bg-white" style={{width:'60px'}}>
                          <div className="flex items-center justify-center gap-0.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => addLayerAt(idx)}
                              title="Thêm dòng bên dưới"
                              className="p-1 rounded hover:bg-emerald-100 text-slate-400 hover:text-emerald-600 transition-all"
                            >
                              <Plus size={13} />
                            </button>
                            <button
                              onClick={() => removeLayer(idx)}
                              disabled={data.layers.length <= 1}
                              title="Xóa dòng này"
                              className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Bảng tổng hợp theo Lớp Thiết Kế */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-black text-black uppercase tracking-widest flex items-center gap-2">
                <BarChart2 size={14} />
                Tổng hợp thống kê theo lớp thiết kế
              </h4>
            </div>
            <div className="overflow-hidden border border-slate-300 rounded-xl shadow-sm bg-white">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full border-collapse table-auto">
                  <thead>
                    <tr className="bg-blue-900 text-white">
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">STT</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Đường kính</th>
                      <th className="px-3 py-2 text-left text-[12px] font-black uppercase tracking-wider border-r border-blue-700" style={{minWidth:'220px'}}>Lớp Thiết Kế</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Số đoạn</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Cao độ từ (m)</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Cao độ đến (m)</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Tổng T.Gian (h)</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Tổng Dài (m)</th>
                      <th className="px-3 py-2 text-center text-[12px] font-black uppercase tracking-wider whitespace-nowrap">V TB (m/h)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(() => {
                      const groupColors = [
                        { row: 'bg-sky-200',     text: 'text-sky-900' },
                        { row: 'bg-amber-200',   text: 'text-amber-900' },
                        { row: 'bg-emerald-200', text: 'text-emerald-900' },
                        { row: 'bg-rose-200',    text: 'text-rose-900' },
                        { row: 'bg-violet-200',  text: 'text-violet-900' },
                        { row: 'bg-lime-200',    text: 'text-lime-900' },
                        { row: 'bg-orange-200',  text: 'text-orange-900' },
                        { row: 'bg-cyan-200',    text: 'text-cyan-900' },
                        { row: 'bg-pink-200',    text: 'text-pink-900' },
                        { row: 'bg-teal-200',    text: 'text-teal-900' },
                        { row: 'bg-red-200',     text: 'text-red-900' },
                        { row: 'bg-indigo-200',  text: 'text-indigo-900' },
                      ];

                      // Dùng cùng logic màu với bảng chi tiết: đếm theo khối liên tiếp
                      const groups: {
                        layerDesign: string;
                        segments: number;
                        elevationFrom: number;
                        elevationTo: number;
                        totalDuration: number;
                        totalLength: number;
                        avgSpeed: number;
                        colorIdx: number;
                      }[] = [];

                      let groupCount = 0;
                      let prevKey = '';
                      data.layers.forEach((layer) => {
                        const key = layer.layerDesign?.trim() || '(Chưa có)';
                        if (key !== prevKey) { groupCount++; prevKey = key; }
                        const colorIdx = Math.max(0, groupCount - 1) % groupColors.length;
                        const last = groups[groups.length - 1];
                        if (last && last.layerDesign === key) {
                          last.segments += 1;
                          last.elevationTo = layer.elevationTo;
                          last.totalDuration += layer.durationHours;
                          last.totalLength += layer.lengthMeters;
                        } else {
                          groups.push({
                            layerDesign: key,
                            segments: 1,
                            elevationFrom: layer.elevationFrom,
                            elevationTo: layer.elevationTo,
                            totalDuration: layer.durationHours,
                            totalLength: layer.lengthMeters,
                            avgSpeed: 0,
                            colorIdx,
                          });
                        }
                      });

                      groups.forEach(g => {
                        g.avgSpeed = g.totalDuration > 0 ? g.totalLength / g.totalDuration : 0;
                      });

                      return groups.map((g, i) => {
                        const { row: rowBg } = groupColors[g.colorIdx];
                        return (
                          <tr key={i} className="hover:opacity-90 transition-colors">
                            <td className={`px-3 py-2 text-[12px] font-bold text-center border-r border-slate-200 ${rowBg}`}>{i + 1}</td>
                            <td className={`px-3 py-2 text-[12px] text-black text-center border-r border-slate-200 ${rowBg}`}>{data.diameter}</td>
                            <td className={`px-3 py-2 text-[12px] font-normal border-r border-slate-200 ${rowBg} text-black whitespace-pre-wrap break-words`}>{g.layerDesign}</td>
                            <td className={`px-3 py-2 text-[12px] text-center border-r border-slate-200 ${rowBg}`}>{g.segments}</td>
                            <td className={`px-3 py-2 text-[12px] text-center border-r border-slate-200 ${rowBg}`}>{formatNumber(g.elevationFrom)}</td>
                            <td className={`px-3 py-2 text-[12px] text-center border-r border-slate-200 ${rowBg}`}>{formatNumber(g.elevationTo)}</td>
                            <td className={`px-3 py-2 text-[12px] text-center border-r border-slate-200 ${rowBg}`}>{formatNumber(g.totalDuration)}</td>
                            <td className={`px-3 py-2 text-[12px] text-center font-semibold border-r border-slate-200 ${rowBg}`}>{formatNumber(g.totalLength)}</td>
                            <td className={cn(
                              "px-3 py-2 text-[12px] text-center border-r border-slate-200",
                              rowBg,
                              g.avgSpeed <= 1 && "bg-red-50"
                            )}>
                              <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold",
                                g.avgSpeed <= 1 ? "text-white bg-red-600 font-black" :
                                g.avgSpeed > 5 ? "text-emerald-800 bg-emerald-100" : "text-orange-800 bg-orange-100"
                              )}>
                                {formatNumber(g.avgSpeed)}
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-400">
                      <td colSpan={3} className="px-3 py-2 text-[12px] font-black text-black uppercase border-r border-slate-300">Tổng cộng</td>
                      <td className="px-3 py-2 text-[12px] font-black text-center text-black border-r border-slate-300">
                        {data.layers.length}
                      </td>
                      <td className="px-3 py-2 text-[12px] font-black text-center text-black border-r border-slate-300">
                        {data.layers.length > 0 ? formatNumber(data.layers[0].elevationFrom) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[12px] font-black text-center text-black border-r border-slate-300">
                        {data.layers.length > 0 ? formatNumber(data.layers[data.layers.length - 1].elevationTo) : '—'}
                      </td>
                      <td className="px-3 py-2 text-[12px] font-black text-center text-black border-r border-slate-300">
                        {formatNumber(data.layers.reduce((s, l) => s + l.durationHours, 0))}
                      </td>
                      <td className="px-3 py-2 text-[12px] font-black text-center text-black border-r border-slate-300">
                        {formatNumber(data.layers.reduce((s, l) => s + l.lengthMeters, 0))}
                      </td>
                      <td className="px-3 py-2 text-[12px] font-black text-center text-black">
                        {(() => {
                          const totalLen = data.layers.reduce((s, l) => s + l.lengthMeters, 0);
                          const totalDur = data.layers.reduce((s, l) => s + l.durationHours, 0);
                          return totalDur > 0 ? formatNumber(totalLen / totalDur) : '—';
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Right: File Viewer */}
        {/* Right: File Viewer - 38% màn hình */}
        <div className="bg-slate-100 relative group flex flex-col shrink-0" style={{ width: '38%' }}>
          {/* Toolbar for Viewer - luôn hiển thị */}
          {displayUrl && (
            <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-slate-200 shrink-0 z-20">
              <div className="flex gap-2">
                <a 
                  href={displayUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-slate-50 rounded-lg text-blue-900 text-[12px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all border border-slate-200 flex items-center gap-1.5"
                >
                  <ExternalLink size={12} />
                  Mở tab mới
                </a>
                <a 
                  href={displayUrl} 
                  download
                  className="px-3 py-1.5 bg-slate-50 rounded-lg text-blue-900 text-[12px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all border border-slate-200 flex items-center gap-1.5"
                >
                  <ArrowDownToLine size={12} />
                  Tải xuống
                </a>
              </div>
              {/* Tên file — hiển thị giữa thanh toolbar */}
              <div className="flex-1 mx-3 min-w-0">
                <p className="text-[11px] font-black text-slate-600 uppercase tracking-widest truncate text-center"
                   title={data.fileName || ''}>
                  {data.fileName || '—'}
                </p>
              </div>

              <div className="flex items-center gap-1">
                {isPdf && numPages > 0 && (
                  <div className="flex items-center gap-1 mr-2">
                    <button onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1} className="p-1 text-blue-900 disabled:opacity-30 hover:text-blue-600">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[12px] font-black text-blue-900">{pageNumber}/{numPages}</span>
                    <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages} className="p-1 text-blue-900 disabled:opacity-30 hover:text-blue-600">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
                <button onClick={handleZoomOut} className="p-1.5 hover:bg-slate-100 rounded-lg text-blue-900 transition-colors" title="Thu nhỏ"><ZoomOutIcon size={14} /></button>
                <span className="text-[12px] font-black text-blue-900 w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={handleZoomIn} className="p-1.5 hover:bg-slate-100 rounded-lg text-blue-900 transition-colors" title="Phóng to"><ZoomInIcon size={14} /></button>
                <button onClick={handleResetZoom} className="p-1.5 hover:bg-slate-100 rounded-lg text-blue-900 transition-colors ml-1" title="Đặt lại"><RotateCcw size={14} /></button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-sky-400 gap-4">
              <Loader2 size={48} className="animate-spin text-blue-500" />
              <p className="text-xs font-black uppercase tracking-widest opacity-60">Đang tải tài liệu...</p>
            </div>
          ) : loadError ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-red-500 gap-4 p-8 text-center">
              <AlertCircle size={48} className="opacity-50" />
              <div>
                <p className="text-sm font-black uppercase tracking-widest">Lỗi tải tài liệu</p>
                <p className="text-[12px] opacity-60 mt-1">{loadError}</p>
              </div>
              <button 
                onClick={() => setDisplayUrl(displayUrl)} 
                className="mt-4 px-6 py-2 bg-sky-50 hover:bg-sky-100 text-blue-900 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all"
              >
                Thử lại
              </button>
            </div>
          ) : displayUrl ? (
            isPdf ? (
              <div 
                className="w-full h-full bg-[#1e1e1e] relative"
                style={{ overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'grab' }}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: isDragging ? 'none' : 'transform 0.05s ease-out',
                  userSelect: 'none',
                  boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
                }}>
                  <Document
                    file={displayUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(err) => {
                      console.error("PDF Load Error:", err);
                      setLoadError("Không thể tải file PDF. Vui lòng thử mở trong tab mới.");
                    }}
                    loading={
                      <div className="flex flex-col items-center justify-center p-20 text-white">
                        <Loader2 className="w-8 h-8 animate-spin mb-2" />
                        <p className="text-sm">Đang tải PDF...</p>
                      </div>
                    }
                  >
                    <Page 
                      pageNumber={pageNumber}
                      width={PDF_RENDER_WIDTH}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      canvasBackground="white"
                    />
                  </Document>
                </div>
              </div>
            ) : (
              <div 
                className="w-full h-full bg-[#1e1e1e] relative"
                style={{ overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'grab' }}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <img 
                  src={displayUrl} 
                  alt="Tài liệu đã quét" 
                  draggable={false}
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.05s ease-out',
                    userSelect: 'none',
                    maxWidth: 'none',
                    // Fit ảnh vừa khung khi zoom=1, giữ nguyên độ phân giải thực khi zoom>1
                    width: 'auto',
                    height: 'auto',
                    maxHeight: '95%',
                    objectFit: 'contain',
                    imageRendering: zoom > 1.5 ? 'auto' : 'auto',
                    boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
                  }}
                  onLoad={(e) => {
                    // Reset position khi ảnh mới load
                    positionRef.current = { x: 0, y: 0 };
                    setPosition({ x: 0, y: 0 });
                    setZoom(1);
                  }}
                  onError={(e) => {
                    console.error("Image load failed", e);
                    fetch(displayUrl!)
                      .then(res => { if (!res.ok) return res.text(); return null; })
                      .then(text => {
                        if (text) setLoadError(text);
                        else setLoadError("Không thể hiển thị hình ảnh. Vui lòng thử mở trong tab mới.");
                      })
                      .catch(() => setLoadError("Không thể hiển thị hình ảnh. Vui lòng thử mở trong tab mới."));
                  }}
                />
              </div>
            )
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-sky-600 gap-4">
              <ImageIcon size={64} className="opacity-20" />
              <p className="text-sm font-black uppercase tracking-widest opacity-40">Không tìm thấy tệp tài liệu</p>
            </div>
          )}


        </div>
      </div>
    </div>
  );
}
