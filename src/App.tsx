import React, { useState, useRef, useEffect } from 'react';
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
  ArrowRight
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

// Helper: Chuyển đổi PDF sang ảnh (JPEG) để nhúng vào Excel
const convertPdfToImage = async (data: ArrayBuffer | Blob | File | string): Promise<string> => {
  try {
    let arrayBuffer: ArrayBuffer;
    if (typeof data === 'string') {
      // Hỗ trợ cả data URL và base64 thô
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
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      await (page as any).render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.8);
    }
    throw new Error("Không thể tạo context canvas");
  } catch (err) {
    console.error("PDF to Image conversion error:", err);
    throw err;
  }
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  stt?: number;       // Số thứ tự từ Supabase
  excelUrl?: string;  // URL file Excel đã tạo và upload GitHub
  _base64?: string;   // Tạm lưu để upload GitHub khi xác nhận
  _mimeType?: string;
  designLayerMap?: Record<string, string>; // Bảng tra cứu lớp địa chất
}

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

const prepareFile = async (file: File): Promise<{ base64: string; mimeType: string; fileName: string }> => {
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
      const b = await convertPdfToImage(file);
      return { base64: b, mimeType: 'image/jpeg', fileName: file.name.replace(/\.[^/.]+$/, '') + '.jpg' };
    } catch {
      return { base64: await getBase64(file), mimeType: 'application/pdf', fileName: file.name };
    }
  } else if (file.type.startsWith('image/')) {
    return { base64: await compressImage(file), mimeType: 'image/jpeg', fileName: file.name };
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
// Định dạng: "HH:mm DD/MM/YYYY"
const calcConstructionDurationHours = (start: string, end: string): number => {
  if (!start || !end) return 0;
  const parseDateTime = (s: string): Date | null => {
    // Expect "HH:mm DD/MM/YYYY"
    const m = s.trim().match(/(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return new Date(parseInt(m[5]), parseInt(m[4]) - 1, parseInt(m[3]), parseInt(m[1]), parseInt(m[2]));
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

// --- Gemini Service ---

const extractDataFromFile = async (base64Data: string, mimeType: string, userApiKey?: string): Promise<Omit<ExtractionResult, 'id' | 'timestamp'>> => {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key không tồn tại. Vui lòng cấu hình trong phần Cài đặt.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentFormattedDate = `${currentDate.getDate().toString().padStart(2, '0')}/${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentYear}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            text: `Bạn là một chuyên gia phân tích dữ liệu xây dựng cao cấp. Hãy trích xuất dữ liệu từ hình ảnh/PDF "Biên bản theo dõi địa chất khoan cọc nhồi" với độ chính xác tuyệt đối 100%.
            
THÔNG TIN NGỮ CẢNH:
- Ngày hiện tại: ${currentFormattedDate}
- Năm hiện tại: ${currentYear}
- LƯU Ý QUAN TRỌNG: Nếu năm trong văn bản trông giống "2024" nhưng hiện tại là năm ${currentYear}, hãy kiểm tra kỹ xem có phải đó là số "${currentYear.toString().slice(-1)}" viết tay không. Ưu tiên tính logic của thời gian thực tế.

QUY TẮC TRÍCH XUẤT (BẮT BUỘC):
1. THÔNG TIN CHUNG (HEADER):
   - "project" (Dự án): Trích xuất từ dòng "Dự án: ...".
   - "item" (Hạng mục): Trích xuất CHÍNH XÁC từ dòng "Hạng mục: ...". LƯU Ý: Trong văn bản có cả dòng "Công trình" và "Hạng mục", bạn PHẢI lấy dữ liệu từ dòng "Hạng mục". Ví dụ: Nếu thấy "Hạng mục: Thi công cầu vượt...", hãy lấy "Thi công cầu vượt...".
   - "componentName" (Tên bộ phận): Trích xuất từ dòng "Tên bộ phận: ...". Phải bao gồm cả phần chữ viết tay (ví dụ: "Cọc khoan nhồi - Trụ HN P479").
   - "pileId" (Số hiệu cọc): Trích xuất từ dòng "Cọc: ...". Đây thường là phần chữ viết tay (ví dụ: "C9").
   - "reportNumber" (Biên bản số): Trích xuất từ dòng "Biên bản số: ...". (ví dụ: "01/BB-TDC").
   - "diameter" (Đường kính): Trích xuất từ dòng "Đường kính: ...". (ví dụ: "D2000").

2. ĐỊA TẦNG VÀ BẢNG TRA CỨU (CỰC KỲ QUAN TRỌNG):
   - BƯỚC 1: Tìm bảng "Căn cứ Hồ sơ BVBPCT được duyệt" (thường nằm ở phía trên bên trái). Đây là bảng quy định mô tả địa chất cho từng lớp.
   - BƯỚC 2: Trích xuất bảng này thành "designLayerMap". Ví dụ: { "1": "Sét pha màu xám đen...", "2": "Sét màu xám ghi...", "3": "Cát xám ghi..." }. PHẢI ĐỐI CHIẾU TỪNG DÒNG, KHÔNG ĐƯỢC NHẦM LẪN.
   - BƯỚC 3: Khi trích xuất các dòng trong bảng "Chi tiết các lớp địa chất" (bảng chính bên dưới):
     - "actualGeology": Lấy số hiệu từ cột "Địa chất thực tế" (ví dụ: "1", "2").
     - "layerDesign": BẮT BUỘC phải lấy mô tả tương ứng với số hiệu đó từ bảng "designLayerMap" đã trích xuất ở Bước 2. Đây chính là logic VLOOKUP.
   - "designLayerCode": Là số hiệu lớp thiết kế (lấy từ cột đầu tiên của bảng tra cứu).
   - "actualGeology": Trích xuất CHÍNH XÁC số hiệu từ cột "Địa chất thực tế". Đây PHẢI là một con số (ví dụ: "1", "2", "3"). TUYỆT ĐỐI KHÔNG trích xuất mô tả bằng chữ vào ô này.
   - "layerNumber": Số thứ tự dòng trong bảng (1, 2, 3...).

3. TRÍCH XUẤT THỜI GIAN VÀ NGÀY THÁNG (CỰC KỲ QUAN TRỌNG - KIỂM TRA 3 LẦN):
   - Thời gian (timeFrom, timeTo): Trích xuất CHÍNH XÁC từng chữ số giờ và phút (ví dụ: 10h57, 11h26, 12h55).
   - Ngày tháng (dateFrom, dateTo, constructionStart, constructionEnd): Trích xuất CHÍNH XÁC ngày, tháng, năm. 
   - CẢNH BÁO NĂM: Nếu năm viết tay trông mập mờ, hãy đối chiếu với năm hiện tại (${currentYear}). Nếu văn bản ghi "2026" thì PHẢI trích xuất là "2026", KHÔNG ĐƯỢC tự ý đổi thành "2024".
   - CẢNH BÁO CHỮ VIẾT TAY: Chữ viết tay số "1" và "2", hoặc "4" và "6" có thể giống nhau. Hãy nhìn kỹ ngữ cảnh và hình dạng nét vẽ. 
   - KHÔNG ĐƯỢC tự ý làm tròn hoặc tự ý gán thời gian bắt đầu của dòng sau bằng thời gian kết thúc của dòng trước nếu hình ảnh không ghi như vậy. Nếu có khoảng nghỉ (ví dụ từ 11h26 đến 12h55), hãy trích xuất đúng các mốc thời gian ghi trên giấy.
   - Kiểm tra tính logic: Thời gian kết thúc phải sau thời gian bắt đầu. Nếu thấy vô lý (ví dụ 10h57 đến 10h26), hãy xem lại xem có phải bạn đọc nhầm số "1" thành "0" hoặc ngược lại không.

4. TRÍCH XUẤT CAO ĐỘ (CHÍNH XÁC ĐẾN TỪNG CHỮ SỐ THẬP PHÂN):
   - Cao độ (elevationFrom, elevationTo): Trích xuất ĐẦY ĐỦ số thập phân (ví dụ: -8.81, -10.88, -12.94). 
   - Tuyệt đối không bỏ sót dấu phẩy/chấm thập phân. Kiểm tra kỹ từng chữ số.

Yêu cầu JSON:
- project, item, componentName, pileId, reportNumber, diameter.
- constructionStart, constructionEnd (HH:mm DD/MM/YYYY).
- layers: [
    {
      designLayerCode, actualGeology, layerNumber, layerDesign,
      timeFrom, timeTo, dateFrom, dateTo, elevationFrom, elevationTo,
      notes
    }
  ]
- designLayerMap: { "1": "mô tả 1", ... }
- notes: Ghi chú tổng hợp cho toàn bộ biên bản (nếu có).

LƯU Ý QUAN TRỌNG: Trước khi trả về kết quả, hãy kiểm tra lại xem "item" có đúng là lấy từ dòng "Hạng mục" không, và "componentName" có đúng là lấy từ dòng "Tên bộ phận" không. Đừng nhầm lẫn giữa Dự án, Công trình, Hạng mục và Tên bộ phận.`
          },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data.includes(',') ? base64Data.split(',')[1] : base64Data
            }
          }
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
          reportNumber: { type: Type.STRING },
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
                elevationFrom: { type: Type.NUMBER },
                elevationTo: { type: Type.NUMBER },
                actualGeology: { type: Type.STRING, description: "Số hiệu lớp địa chất thực tế (ví dụ: \"1\", \"2\"). Tuyệt đối không lấy mô tả chữ." },
                notes: { type: Type.STRING, description: "Ghi chú cho lớp địa chất này (nếu có)" }
              },
              required: ["layerNumber", "designLayerCode", "layerDesign", "timeFrom", "timeTo", "dateFrom", "dateTo", "elevationFrom", "elevationTo", "actualGeology"]
            }
          },
          notes: { type: Type.STRING, description: "Ghi chú tổng hợp cho toàn bộ biên bản" }
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
      if (code && desc) vlookupMap[code.toString().trim()] = desc as string;
    });
  }

  const processedLayers = rawData.layers.map((layer: any) => {
    const geoCode = (layer.actualGeology || '').toString().trim();
    
    // Áp dụng VLOOKUP: Nếu mã địa chất thực tế có trong bảng tra cứu, lấy mô tả từ đó
    if (geoCode && vlookupMap[geoCode]) {
      layer.layerDesign = vlookupMap[geoCode];
      layer.designLayerCode = geoCode; // Đồng bộ luôn mã thiết kế
    }

    const startMinutes = parseTimeToMinutes(layer.timeFrom);
    const endMinutes = parseTimeToMinutes(layer.timeTo);
    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes < 0) durationMinutes += 24 * 60;
    if (durationMinutes <= 0) durationMinutes = 30; 
    const durationHours = durationMinutes / 60;
    const length = Math.abs(layer.elevationTo - layer.elevationFrom);
    const speed = durationHours > 0 ? length / durationHours : 0;

    // Giữ nguyên actualGeology từ AI (đã yêu cầu lấy số hiệu lớp "1", "2"...)
    const cleanGeo = (layer.actualGeology || '').toString().trim();

    return {
      ...layer,
      actualGeology: cleanGeo,
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
      lengthMeters: length,
      speedMph: speed
    };
  });

  return { 
    ...rawData, 
    constructionStart: normalizeDateTime(rawData.constructionStart), 
    constructionEnd: normalizeDateTime(rawData.constructionEnd), 
    layers: processedLayers,
    notes: rawData.notes || ''
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
  const [filterReportNumber, setFilterReportNumber] = useState('');
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

      const savedLogo = localStorage.getItem('pile_drill_custom_logo');
      if (savedLogo) setCustomLogo(savedLogo);

      if (supabase) {
        try {
          // 1 & 2: Gọi song song để tiết kiệm thời gian và Egress
          const [historyRes, settingsRes] = await Promise.all([
            supabase
              .from('drill_extractions')
              // Lấy đầy đủ layers để tính chiều dài, thời gian, vận tốc chính xác
              .select('id, timestamp, project, item, componentName, pileId, reportNumber, diameter, constructionStart, constructionEnd, notes, fileName, fileUrl, excelUrl, stt, layers')
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
              return {
                ...local,
                ...row,
                // Luôn giữ layers: ưu tiên Supabase nếu có, fallback về local, cuối cùng là []
                layers: (Array.isArray(row.layers) && row.layers.length > 0)
                  ? row.layers
                  : (Array.isArray(local.layers) && local.layers.length > 0)
                    ? local.layers
                    : [],
              };
            });
            setHistory(merged);
            // Lưu lại localStorage với data mới nhất (chỉ fields đã fetch)
            localStorage.setItem('pile_drill_history', JSON.stringify(merged));
          } else {
            console.warn('[loadData] Supabase history error:', historyRes.error?.message);
            const savedHistory = localStorage.getItem('pile_drill_history');
            if (savedHistory) {
              try { setHistory(JSON.parse(savedHistory)); } catch {}
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
            try { setHistory(JSON.parse(savedHistory)); } catch {}
          }
        }
      } else {
        const savedHistory = localStorage.getItem('pile_drill_history');
        if (savedHistory) {
          try { setHistory(JSON.parse(savedHistory)); } catch {}
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
          const newRow = payload.new as ExtractionResult;
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
          const updated = payload.new as ExtractionResult;
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
    setUserApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    
    if (supabase) {
      try {
        // Lưu API key
        await supabase
          .from('app_settings')
          .upsert({ id: 'gemini_api_key', value: key, updated_at: new Date().toISOString() });

        // Đồng thời lưu logo hiện tại (re-sync để chắc chắn không bị mất sau F5)
        const logoValue = customLogo || '';
        await supabase
          .from('app_settings')
          .upsert({ id: 'app_logo', value: logoValue, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to save settings to Supabase", e);
      }
    }
    
    setIsSettingsOpen(false);
    // Không cần alert — chỉ báo lỗi khi thực sự fail
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
            const { base64, mimeType, fileName } = await prepareFile(file);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 40 } : f));

            // Bước 2: gọi AI — 40→90%
            const rawResult = await extractDataFromFile(base64, mimeType, userApiKey);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 90 } : f));

            // Tự động tra cứu (VLOOKUP) mô tả địa chất dựa trên mã địa chất thực tế
            const map = rawResult.designLayerMap || {};
            const normalizedLayers = (rawResult.layers || []).map(layer => {
              const geoCode = (layer.actualGeology || '').trim();
              const currentDesign = (layer.layerDesign || '').trim();
              
              // Nếu dòng đã có mô tả và mô tả đó dài hơn/chi tiết hơn Map, giữ nguyên dòng
              if (geoCode && map[geoCode]) {
                if (!currentDesign || currentDesign.length < 5) {
                  return { ...layer, layerDesign: map[geoCode] };
                }
                // Nếu mô tả dòng và Map khác nhau, ưu tiên Map vì người dùng muốn tính nhất quán (VLOOKUP)
                // Nhưng chỉ khi Map có dữ liệu thực sự khác biệt
                if (currentDesign !== map[geoCode]) {
                  return { ...layer, layerDesign: map[geoCode] };
                }
              }
              return layer;
            });

            const result: ExtractionResult = {
              ...rawResult,
              layers: normalizedLayers,
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              fileName,
              _base64: base64,
              _mimeType: mimeType,
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
        return (gc - 1) % GROUP_COLORS.length;
      });

      const ws1 = wb.addWorksheet('Chi tiết địa chất');
      ws1.columns = [
        { width: 14 },{ width: 11 },{ width: 46 },{ width: 13 },{ width: 13 },
        { width: 11 },{ width: 11 },{ width: 11 },{ width: 9 },{ width: 9 },{ width: 28 },
      ];

      const infoItems = [
        ['Dự án', result.project],['Hạng mục', result.item],
        ['Tên bộ phận', result.componentName],['Số hiệu cọc', result.pileId],
        ['Biên bản số', result.reportNumber],['Đường kính', result.diameter],
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
          layer.actualGeology, result.diameter, layer.layerDesign,
          layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
          layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
          layer.elevationFrom, layer.elevationTo,
          parseFloat(layer.durationHours.toFixed(2)),
          parseFloat(layer.lengthMeters.toFixed(2)),
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
        const ci2 = (gc2 - 1) % GROUP_COLORS.length;
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
        const vals2 = [i + 1, result.diameter, g.layerDesign, g.segments, parseFloat(g.elevationFrom.toFixed(2)), parseFloat(g.elevationTo.toFixed(2)), parseFloat(g.totalDuration.toFixed(2)), parseFloat(g.totalLength.toFixed(2)), parseFloat(g.avgSpeed.toFixed(2))];
        const r2 = ws2.addRow(vals2);
        r2.height = 32;
        vals2.forEach((v, ci) => {
          const isSpd = ci === 8;
          applyCell(r2.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? (isSlowSpd ? 'FFFFFF' : 'C2410C') : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 ? 'left' : 'center', wrap: ci === 2, border: thinBorder() });
        });
      });

      const totVals = ['TỔNG CỘNG','','',result.layers.length,
        result.layers.length > 0 ? parseFloat(result.layers[0].elevationFrom.toFixed(2)) : '',
        result.layers.length > 0 ? parseFloat(result.layers[result.layers.length - 1].elevationTo.toFixed(2)) : '',
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

    // Kiểm tra tính nhất quán cho TẤT CẢ biên bản trước khi lưu
    for (const r of pendingResults) {
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
            const remaining = pendingResults.filter(x => x.id !== r.id);
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
    const resultsToSave = [...pendingResults];
    
    for (const r of resultsToSave) {
      await saveResult(r, true); // đã validate ở trên rồi
    }
    
    setPendingResults([]);
    setProcessingFiles([]);
    setCurrentResult(null);
    setIsProcessing(false);
    setActiveSheet('summary');
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
          safeResult = { ...safeResult, layers: data.layers };
          // Cập nhật lại history state để lần sau không cần fetch lại
          setHistory(prev => prev.map(r => r.id === result.id ? { ...r, layers: data.layers } : r));
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
        return (gc - 1) % GROUP_COLORS.length;
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
        ['Biên bản số', item.reportNumber], ['Đường kính', item.diameter],
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
          layer.actualGeology, item.diameter, layer.layerDesign,
          layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
          layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
          layer.elevationFrom, layer.elevationTo,
          parseFloat(layer.durationHours.toFixed(2)),
          parseFloat(layer.lengthMeters.toFixed(2)),
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
        const ci2 = (gc2b - 1) % GROUP_COLORS.length;
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
        const vals2 = [i + 1, item.diameter, g.layerDesign, g.segments, parseFloat(g.elevationFrom.toFixed(2)), parseFloat(g.elevationTo.toFixed(2)), parseFloat(g.totalDuration.toFixed(2)), parseFloat(g.totalLength.toFixed(2)), parseFloat(g.avgSpeed.toFixed(2))];
        const r2 = ws2.addRow(vals2);
        r2.height = 32;
        vals2.forEach((v, ci) => {
          const isSpd = ci === 8;
          applyCell(r2.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? (isSlowSpd ? 'FFFFFF' : 'C2410C') : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 ? 'left' : 'center', wrap: ci === 2, border: thinBorder() });
        });
      });
      const totVals2 = ['TỔNG CỘNG', '', '', item.layers.length,
        item.layers.length > 0 ? parseFloat(item.layers[0].elevationFrom.toFixed(2)) : '',
        item.layers.length > 0 ? parseFloat(item.layers[item.layers.length - 1].elevationTo.toFixed(2)) : '',
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
      const HDRS0 = ['STT', 'Dự án', 'Hạng mục', 'Tên bộ phận', 'Số hiệu', 'Biên bản số', 'Đường kính', 'Bắt đầu', 'Kết thúc', 'Chiều dài (m)', 'T.Gian TC (h)', 'Vận tốc TB (m/h)', 'Sheet ảnh'];
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
      const HDRS1 = ['STT', 'Dự án', 'Hạng mục', 'Tên bộ phận', 'Số hiệu', 'Biên bản số', 'ĐC thực tế', 'Đường kính', 'Mô tả lớp thiết kế', 'Từ (h)', 'Đến (h)', 'Cao độ từ', 'Cao độ đến', 'T.Gian (h)', 'Dài (m)', 'V (m/h)', 'Ghi chú'];
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
            res.reportNumber, layer.actualGeology, res.diameter, layer.layerDesign,
            layer.timeFrom + ' ' + layer.dateFrom, layer.timeTo + ' ' + layer.dateTo,
            layer.elevationFrom, layer.elevationTo,
            parseFloat(layer.durationHours.toFixed(2)), parseFloat(layer.lengthMeters.toFixed(2)),
            parseFloat(layer.speedMph.toFixed(2)), layer.notes,
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
      const HDRS2 = ['STT', 'Dự án', 'Hạng mục', 'Tên bộ phận', 'Số hiệu', 'Biên bản số', 'Đường kính', 'Ký hiệu ĐC', 'Mô tả lớp thiết kế', 'Số mẫu', 'Tổng Dài (m)', 'Tổng T.Gian (h)', 'V.TB (m/h)'];
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
          ['Biên bản số', res.reportNumber], ['Đường kính', res.diameter],
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
          return (gc - 1) % GROUP_COLORS.length;
        });
        (res.layers || []).forEach((layer, ri) => {
          const { bg, font: fontColor } = GROUP_COLORS[rowColorIdx[ri]];
          const spd = layer.speedMph;
          const isSlowSpd = spd > 0 && spd <= 1;
          const spdBg = isSlowSpd ? 'DC2626' : spd > 5 ? 'D1FAE5' : 'FFF7ED';
          const spdFontColor = isSlowSpd ? 'FFFFFF' : 'C2410C';
          const vals = [
            layer.actualGeology, res.diameter, layer.layerDesign,
            layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
            layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
            layer.elevationFrom, layer.elevationTo,
            parseFloat(layer.durationHours.toFixed(2)),
            parseFloat(layer.lengthMeters.toFixed(2)),
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

  // ── GeologyView: Cấu tạo lớp địa chất ──
  const GeologyView = () => {
    const [editingKey, setEditingKey] = React.useState<string | null>(null);
    const [editValue, setEditValue] = React.useState('');
    const [savingKey, setSavingKey] = React.useState<string | null>(null);
    const [syncStatus, setSyncStatus] = React.useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
    const [syncCount, setSyncCount] = React.useState(0);

    // UNIQUE chỉ theo layerDesign
    type UniqueLayer = { layerDesign: string; count: number; };

    const uniqueLayers: UniqueLayer[] = React.useMemo(() => {
      // Map key = layerDesign.trim() (case-sensitive để giữ nguyên chữ)
      const map = new Map<string, UniqueLayer>();
      history.forEach(res => {
        (res.layers || []).forEach(layer => {
          const design = (layer.layerDesign || '').trim();
          if (!design) return;
          const key = design;
          if (map.has(key)) {
            map.get(key)!.count++;
          } else {
            map.set(key, { layerDesign: design, count: 1 });
          }
        });
      });
      // Sắp xếp A-Z theo layerDesign
      return Array.from(map.values()).sort((a, b) =>
        (a.layerDesign || '').localeCompare(b.layerDesign || '', 'vi', { sensitivity: 'base' })
      );
    }, [history]);

    const startEdit = (layerDesign: string) => {
      setEditingKey(layerDesign);
      setEditValue(layerDesign);
    };
    const cancelEdit = () => { setEditingKey(null); setEditValue(''); };

    // Khi lưu: cập nhật TẤT CẢ layers trong TẤT CẢ biên bản có cùng layerDesign cũ
    const commitEdit = async (oldDesign: string) => {
      const newDesign = editValue.trim();
      if (!newDesign || newDesign === oldDesign) { cancelEdit(); return; }

      type ToUpdate = { result: ExtractionResult; newLayers: DrillLayer[] };
      const toUpdateList: ToUpdate[] = [];
      history.forEach(res => {
        const hasMatch = (res.layers || []).some(l => (l.layerDesign || '').trim() === oldDesign);
        if (!hasMatch) return;
        const newLayers = res.layers.map(l =>
          (l.layerDesign || '').trim() === oldDesign ? { ...l, layerDesign: newDesign } : l
        );
        toUpdateList.push({ result: res, newLayers });
      });

      // Cập nhật local state ngay lập tức
      setHistory(prev => prev.map(res => {
        const found = toUpdateList.find(u => u.result.id === res.id);
        return found ? { ...res, layers: found.newLayers } : res;
      }));
      cancelEdit();

      setSavingKey(newDesign);
      setSyncStatus('syncing');
      setSyncCount(toUpdateList.length);
      let errorCount = 0;
      try {
        if (supabase) {
          await Promise.all(toUpdateList.map(async ({ result, newLayers }) => {
            try {
              const { error } = await supabase.from('drill_extractions').update({ layers: newLayers }).eq('id', result.id);
              if (error) errorCount++;
            } catch { errorCount++; }
          }));
          try {
            const savedHistory = localStorage.getItem('pile_drill_history');
            if (savedHistory) {
              const arr = JSON.parse(savedHistory);
              const updatedMap = new Map(toUpdateList.map(u => [u.result.id, u.newLayers]));
              localStorage.setItem('pile_drill_history', JSON.stringify(
                arr.map((r: any) => updatedMap.has(r.id) ? { ...r, layers: updatedMap.get(r.id) } : r)
              ));
            }
          } catch {}
          if (errorCount === 0) {
            setSyncStatus('done');
            showToast(`✅ Đã cập nhật "${newDesign}" trong ${toUpdateList.length} biên bản!`, 'success', 3000);
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

    return (
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <Layers size={24} className="text-blue-600" /> Cấu tạo lớp địa chất
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Danh sách <strong>không trùng lặp</strong> — chỉnh sửa tên lớp sẽ <strong>đồng bộ toàn bộ biên bản</strong> liên quan
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        {/* Table — multi-column để hiển thị vừa màn hình không cần scroll */}
        {uniqueLayers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-16 text-center">
            <Layers size={48} className="text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">Chưa có dữ liệu lớp địa chất</p>
            <p className="text-sm text-slate-400 mt-1">Hãy upload biên bản để xem dữ liệu</p>
          </div>
        ) : (() => {
          // Chia uniqueLayers thành các cột, mỗi cột tối đa 15 dòng
          const ROWS_PER_COL = 15;
          const cols: typeof uniqueLayers[] = [];
          for (let i = 0; i < uniqueLayers.length; i += ROWS_PER_COL) {
            cols.push(uniqueLayers.slice(i, i + ROWS_PER_COL));
          }
          return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex gap-0 divide-x divide-slate-200">
                {cols.map((colRows, colIdx) => (
                  <div key={colIdx} className="flex-1 min-w-0">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr style={{ background: '#1a3a6b' }}>
                          <th className="px-3 py-3 text-xs font-bold text-white text-center w-10 border-r border-blue-800/30">#</th>
                          <th className="px-3 py-3 text-xs font-bold text-white text-left border-r border-blue-800/30">Mô tả lớp thiết kế</th>
                          <th className="px-3 py-3 text-xs font-bold text-white text-center w-20 whitespace-nowrap">Số lần</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colRows.map((row, rowIdx) => {
                          const globalIdx = colIdx * ROWS_PER_COL + rowIdx;
                          const isEditing = editingKey === row.layerDesign;
                          const isSaving = savingKey === row.layerDesign;
                          const rowBg = globalIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
                          return (
                            <tr key={row.layerDesign} style={{ background: rowBg }} className="border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
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
                                        if (e.key === 'Enter') commitEdit(row.layerDesign);
                                        if (e.key === 'Escape') cancelEdit();
                                      }}
                                    />
                                    <button onClick={() => commitEdit(row.layerDesign)}
                                      className="flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-xs px-2 py-1 rounded-lg font-semibold transition-colors whitespace-nowrap">
                                      <CheckCircle2 size={11} /> Lưu
                                    </button>
                                    <button onClick={cancelEdit}
                                      className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs px-2 py-1 rounded-lg font-semibold transition-colors">
                                      <X size={11} /> Hủy
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 group cursor-pointer" onClick={() => !isSaving && startEdit(row.layerDesign)}>
                                    {isSaving ? (
                                      <span className="flex items-center gap-1.5 text-blue-600 text-xs">
                                        <Loader2 size={12} className="animate-spin" /> Đang lưu...
                                      </span>
                                    ) : (
                                      <>
                                        <span className="text-xs text-slate-700 leading-snug">{row.layerDesign}</span>
                                        <Edit2 size={11} className="text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="inline-flex items-center justify-center bg-blue-50 text-blue-700 font-bold text-xs px-2 py-0.5 rounded-full border border-blue-200">
                                  {row.count}
                                </span>
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
          );
        })()}
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
              <span className="font-medium text-sm">Cấu tạo lớp địa chất</span>
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
                if (filterReportNumber && !item.reportNumber?.toLowerCase().includes(filterReportNumber.toLowerCase())) return false;
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

              const hasActiveFilter = filterProject || filterItem || filterComponentName || filterReportNumber || filterDiameter || filterDateFrom || filterDateTo || filterStt;

              const resetFilters = () => {
                setFilterProject(''); setFilterItem(''); setFilterComponentName('');
                setFilterReportNumber(''); setFilterDiameter('');
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
                          {[filterProject, filterItem, filterComponentName, filterReportNumber, filterDiameter, filterDateFrom, filterDateTo, filterStt].filter(Boolean).length}
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
                      {/* Biên bản số */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-black uppercase tracking-[0.15em] ml-1 font-sans">Biên bản số</label>
                        <div className="relative border border-slate-200 rounded-xl bg-white hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
                          <Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <input value={filterReportNumber} onChange={e => setFilterReportNumber(e.target.value)} placeholder="Tìm kiếm biên bản..."
                            className="w-full pl-9 pr-9 py-2.5 text-[12px] bg-transparent outline-none rounded-xl text-slate-900 placeholder-slate-400 font-medium" />
                          {filterReportNumber && <button onClick={() => setFilterReportNumber('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>}
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
                          <th>Biên bản số</th>
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
          />
        )}
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-blue-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-sky-100">
            <div className="bg-blue-600 p-8 text-white flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm border border-white/10">
                  <Settings size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold uppercase tracking-tight leading-none">Cấu hình hệ thống</h3>
                  <p className="text-[10px] text-blue-100 font-bold uppercase tracking-widest mt-1.5">Quản lý API & Giao diện</p>
                </div>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-8 space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-sky-400 uppercase tracking-[0.2em] ml-1">Logo tùy chỉnh</label>
                  <div className="flex items-center gap-4 p-4 bg-sky-50 rounded-2xl border border-sky-100">
                    <div className="w-14 h-14 bg-white rounded-xl overflow-hidden flex items-center justify-center shadow-sm border border-sky-200">
                      {customLogo ? (
                        <img src={customLogo} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Construction className="text-sky-300 w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <button 
                        onClick={() => logoInputRef.current?.click()}
                        className="w-full py-2 bg-white border border-sky-200 rounded-lg text-[10px] font-bold uppercase tracking-widest text-blue-900 hover:bg-sky-50 transition-colors flex items-center justify-center gap-2"
                      >
                        <ImageIcon size={14} />
                        Thay đổi Logo
                      </button>
                      {customLogo && (
                        <button 
                          onClick={resetLogo}
                          className="w-full py-2 bg-white border border-sky-200 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                        >
                          <RotateCcw size={14} />
                          Đặt lại mặc định
                        </button>
                      )}
                    </div>
                    <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-sky-400 uppercase tracking-[0.2em] ml-1">Kết nối GitHub</label>
                  <div className="p-4 bg-sky-50 rounded-2xl border border-sky-100 space-y-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={cn("p-2 rounded-lg", isGithubConnected ? "bg-emerald-100 text-emerald-600" : "bg-sky-200 text-sky-400")}>
                        <Github size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-blue-900 uppercase tracking-tight">
                          {isGithubConnected ? "Đã kết nối GitHub" : "Chưa kết nối GitHub"}
                        </p>
                        <p className="text-[9px] text-sky-400 font-bold uppercase tracking-widest leading-none mt-1">
                          {isGithubConnected ? "Đang đồng bộ tự động" : "Điền thông tin để đồng bộ"}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Personal Access Token</label>
                      <input
                        type="password"
                        value={githubTokenInput}
                        onChange={(e) => setGithubTokenInput(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        className="w-full bg-white border border-sky-200 rounded-xl px-3 py-2 text-blue-900 text-sm font-medium focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">GitHub Username</label>
                      <input
                        type="text"
                        value={githubUsernameInput}
                        onChange={(e) => setGithubUsernameInput(e.target.value)}
                        placeholder="username"
                        className="w-full bg-white border border-sky-200 rounded-xl px-3 py-2 text-blue-900 text-sm font-medium focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Repository Name</label>
                      <input
                        type="text"
                        value={githubRepoInput}
                        onChange={(e) => setGithubRepoInput(e.target.value)}
                        placeholder="construction-reports"
                        className="w-full bg-white border border-sky-200 rounded-xl px-3 py-2 text-blue-900 text-sm font-medium focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <button
                      onClick={connectGithub}
                      disabled={isConnectingGithub}
                      className={cn(
                        "w-full py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all",
                        isGithubConnected
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200"
                          : "bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-100"
                      )}
                    >
                      {isConnectingGithub ? "Đang lưu..." : isGithubConnected ? "✓ Cập nhật kết nối" : "Lưu & kết nối"}
                    </button>

                    {/* Nút dọn rác GitHub: xóa file mồ côi không có trong Supabase */}
                    {isGithubConnected && (
                      <button
                        onClick={async () => {
                          if (!githubCreds) return;
                          if (!window.confirm("Tính năng này sẽ quét GitHub và xóa các file Excel/ảnh KHÔNG có trong Supabase.\n\nTiếp tục?")) return;
                          const { token, username, repo } = githubCreds;
                          const headers = { 'Authorization': `token ${token.trim()}`, 'Accept': 'application/vnd.github.v3+json' };

                          // Lấy danh sách excelUrl và fileUrl đang có trong Supabase
                          const validUrls = new Set<string>();
                          if (supabase) {
                            const { data } = await supabase.from('drill_extractions').select('excelUrl, fileUrl');
                            (data || []).forEach((r: any) => {
                              if (r.excelUrl) validUrls.add(r.excelUrl.split('?')[0]);
                              if (r.fileUrl) validUrls.add(r.fileUrl.split('?')[0]);
                            });
                          }

                          // Quét thư mục SGC-CKN/Excel trên GitHub
                          let deleted = 0;
                          try {
                            const listRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/SGC-CKN/Excel`, { headers });
                            if (listRes.ok) {
                              const files = await listRes.json();
                              for (const f of files) {
                                const rawUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/${f.path}`;
                                if (!validUrls.has(rawUrl)) {
                                  await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${f.path}`, {
                                    method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ message: `Cleanup orphan: ${f.path}`, sha: f.sha })
                                  });
                                  deleted++;
                                }
                              }
                            }
                          } catch (e) { console.error(e); }

                          alert(deleted > 0 ? `✅ Đã dọn ${deleted} file mồ côi trên GitHub.` : "✅ GitHub sạch, không có file mồ côi.");
                        }}
                        className="w-full py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 flex items-center justify-center gap-2"
                      >
                        <Trash2 size={12} /> Dọn rác GitHub
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-sky-400 uppercase tracking-[0.2em] ml-1">Gemini API Key</label>
                  <div className="relative">
                    <input 
                      type="password"
                      value={userApiKey}
                      onChange={(e) => setUserApiKey(e.target.value)}
                      placeholder="Nhập API Key của bạn..."
                      className="w-full bg-sky-50 border border-sky-200 rounded-2xl px-5 py-3.5 text-blue-900 font-medium focus:border-blue-600 focus:ring-0 transition-all outline-none text-sm"
                    />
                  </div>
                </div>
              </div>
              <button 
                onClick={() => saveApiKey(userApiKey)}
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
              >
                <Save size={18} />
                Lưu cấu hình
              </button>
            </div>
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
        <StatCard title="Biên bản số" value={result.reportNumber} icon={<FileText className="text-blue-600" />} />
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

      <div className="modern-card overflow-hidden border border-slate-300 shadow-sm">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse table-fixed min-w-[1500px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="sticky left-0 bg-slate-100 z-20 px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[80px]">ĐỊA CHẤT <br/> THỰC TẾ</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Biên bản số</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Đường kính</th>
                <th className="px-4 py-3 text-left text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[350px]">Mô tả lớp thiết kế</th>
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
                    <div className="text-sm">{layer.actualGeology}</div>
                  </td>
                  <td className="text-black px-4 py-3 text-[12px] border-r border-slate-200 text-center">{result.reportNumber}</td>
                  <td className="text-black px-4 py-3 text-[12px] border-r border-slate-200 text-center">{layer.diameter}</td>
                  <td className="text-black italic text-[12px] leading-relaxed px-4 py-3 border-r border-slate-200 whitespace-pre-wrap break-words">{layer.layerDesign}</td>
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
  const [pages, setPages] = useState<{ name: string; blob: Blob; url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setPages([]);
    } else {
      alert('Vui lòng chọn file PDF.');
    }
  };

  const splitPdf = async () => {
    if (!file) return;
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pageCount = pdfDoc.getPageCount();
      const newPages = [];

      for (let i = 0; i < pageCount; i++) {
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
        newPdf.addPage(copiedPage);
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const name = `${file.name.replace('.pdf', '')}_Trang_${i + 1}.pdf`;
        newPages.push({ name, blob, url });
      }
      setPages(newPages);
    } catch (error) {
      console.error('Error splitting PDF:', error);
      alert('Có lỗi xảy ra khi tách file PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadAll = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    try {
      const zip = new JSZip();
      for (const page of pages) {
        zip.file(page.name, page.blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const zipName = `${file?.name.replace('.pdf', '')}_Tach_File.zip`;
      saveAs(content, zipName);
    } catch (error) {
      console.error('Error creating ZIP:', error);
      alert('Có lỗi xảy ra khi tạo file nén.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
          <div>
            <h3 className="text-[18px] font-black text-black uppercase tracking-tight">Tách file PDF</h3>
            <p className="text-xs text-slate-500 font-medium">Tự động tách PDF nhiều trang thành các file đơn lẻ</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-10 shadow-sm flex flex-col items-center text-center space-y-6">
        <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
          <Scissors size={40} />
        </div>
        
        <div className="max-w-md">
          <h4 className="text-lg font-bold text-slate-900">Chọn file PDF cần tách</h4>
          <p className="text-sm text-slate-500 mt-2">Hệ thống sẽ tách mỗi trang thành một file PDF riêng biệt để bạn dễ dàng quản lý.</p>
        </div>

        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="application/pdf" 
            className="hidden" 
          />
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-blue-900 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 border-2 border-dashed border-slate-300"
          >
            {file ? <FileText size={20} /> : <Upload size={20} />}
            {file ? file.name : 'Chọn file từ máy tính'}
          </button>

          {file && !isProcessing && pages.length === 0 && (
            <button 
              onClick={splitPdf}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-2"
            >
              Bắt đầu tách file
            </button>
          )}

          {isProcessing && (
            <div className="flex items-center gap-3 text-blue-600 font-bold">
              <Loader2 className="animate-spin" />
              Đang xử lý...
            </div>
          )}
        </div>
      </div>

      {pages.length > 0 && (
        <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Kết quả tách file ({pages.length} trang)</h4>
            <button 
              onClick={downloadAll}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-widest flex items-center gap-1.5"
            >
              <ArrowDownToLine size={14} />
              Tải xuống tất cả
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.map((page, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between hover:shadow-md transition-all group">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="bg-red-50 p-2 rounded-lg text-red-500 shrink-0">
                    <FileText size={18} />
                  </div>
                  <span className="text-xs font-bold text-slate-700 truncate">{page.name}</span>
                </div>
                <a 
                  href={page.url} 
                  download={page.name}
                  className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                  title="Tải xuống"
                >
                  <ArrowDownToLine size={18} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryView({ 
  history, 
  onSelectResult, 
  onEdit, 
  onDelete,
  onUploadClick,
  isExportingAll,
  onExportAll,
}: { 
  history: ExtractionResult[], 
  onSelectResult: (res: ExtractionResult) => void,
  onEdit: (res: ExtractionResult) => void,
  onDelete: (id: string) => void,
  onUploadClick: () => void,
  isExportingAll: boolean,
  onExportAll: (rows: ExtractionResult[]) => void,
}) {
  const projects = [...new Set(history.map(r => r.project).filter(Boolean))];
  // Đếm tổng số biên bản (mỗi file/biên bản được coi là 1 thực thể cọc trong thống kê này nếu người dùng muốn khớp với số lượng file đã upload)
  const totalPiles = history.length;
  const totalDepth = history.reduce((acc, r) => acc + (r.layers || []).reduce((s, l) => s + (l.lengthMeters || 0), 0), 0);
  const avgSpeed = history.length > 0
    ? history.reduce((acc, r) => acc + ((r.layers || []).reduce((s, l) => s + (l.speedMph || 0), 0) / (r.layers?.length || 1)), 0) / history.length
    : 0;

  // Tìm các cọc có vận tốc khoan < 1m/h
  const slowPiles = history.filter(r => 
    r.layers.some(l => l.speedMph > 0 && l.speedMph < 1)

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

      {/* ── Tiêu đề ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
          <div>
            <h3 className="text-[18px] font-black text-black uppercase tracking-tight">Dashboard Tổng Hợp</h3>
            <p className="text-xs text-slate-500 font-medium">Tổng quan dữ liệu thi công cọc khoan nhồi</p>
          </div>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cập nhật tự động</span>
      </div>

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
                    BB: {rec.reportNumber || '—'} · {rec.constructionStart || '—'} → {rec.constructionEnd || '—'}
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
                          BB: <span className="font-bold">{rec.reportNumber || '—'}</span>
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

      {/* ── Cảnh báo vận tốc thấp (< 1m/h) ── */}
      {slowPiles.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 bg-red-500 rounded-lg">
              <AlertCircle size={16} className="text-white" />
            </div>
            <h4 className="text-[11px] font-black text-red-700 uppercase tracking-widest">
              Cảnh báo vận tốc khoan thấp (&lt; 1m/h)
            </h4>
            <span className="ml-auto bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
              {slowPiles.length} cọc
            </span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {slowPiles.map((pile) => {
              const slowLayers = pile.layers.filter(l => l.speedMph > 0 && l.speedMph < 1);
              return (
                <button
                  key={pile.id}
                  onClick={() => onEdit(pile)}
                  className="flex flex-col p-3 bg-white border border-red-100 rounded-xl hover:border-red-400 hover:shadow-md transition-all text-left group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-black text-slate-900">Cọc: {pile.pileId || '—'}</span>
                    <ChevronRight size={14} className="text-slate-300 group-hover:text-red-500 transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-500 font-bold uppercase truncate">
                      Dự án: {pile.project || '—'}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {slowLayers.map((l, idx) => (
                        <span key={idx} className="text-[9px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded">
                          Lớp {l.layerNumber}: {l.speedMph.toFixed(2)} m/h
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
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
}: { 
  result: ExtractionResult; 
  onClose: () => void; 
  onSave: (res: ExtractionResult) => void;
  embedded?: boolean;
  githubCreds?: { token: string; username: string; repo: string } | null;
  userApiKey?: string;
}) {
  const [data, setData] = useState<ExtractionResult>(result);
  const [zoom, setZoom] = useState(1);
  const [isFetchingImage, setIsFetchingImage] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanStatus, setRescanStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [isReplacingFile, setIsReplacingFile] = useState(false);

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

        // Upload lên GitHub — thay file cũ nếu có, hoặc tạo mới
        const { token, username, repo } = githubCreds;
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const path = data.fileUrl
          ? (() => {
              const cleanUrl = decodeURIComponent(data.fileUrl.split('?')[0]);
              const m = cleanUrl.match(/raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/[^\/]+\/(.+)/);
              return m ? m[1] : `SGC-CKN/${timestamp}_${safeFileName}`;
            })()
          : `SGC-CKN/${timestamp}_${safeFileName}`;

        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${path}`;
        const headers = {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        };

        // Lấy SHA nếu file đã tồn tại (để ghi đè)
        let sha: string | undefined;
        try {
          const getRes = await fetch(`${apiUrl}?t=${timestamp}`, { headers });
          if (getRes.ok) { const d = await getRes.json(); sha = d.sha; }
        } catch (_) {}

        const putRes = await fetch(apiUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `Replace file: ${safeFileName} via SGC-CKN Web`,
            content: base64Content,
            sha,
          }),
        });

        let newFileUrl = data.fileUrl;
        if (putRes.ok) {
          newFileUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/${path}`;
          // Cập nhật fileUrl và fileName mới lên Supabase ngay sau khi upload GitHub thành công
          try {
            if (supabase) {
              await supabase
                .from('drill_extractions')
                .update({ fileUrl: newFileUrl, fileName: file.name })
                .eq('id', data.id);
            }
          } catch (sbErr) {
            console.warn('[replaceFile] Không thể cập nhật fileUrl lên Supabase:', sbErr);
          }
        } else {
          const err = await putRes.json();
          alert(`⚠️ Lỗi upload GitHub: ${err.message || 'Không thể upload'}. Vẫn tiếp tục quét AI với file mới.`);
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

          const rawResult = await extractDataFromFile(normalized.base64, normalized.mime, userApiKey);
          const map = rawResult.designLayerMap || {};
          const normalizedLayers = (rawResult.layers || []).map((layer: any) => {
            const geoCode = (layer.actualGeology || '').trim();
            const currentDesign = (layer.layerDesign || '').trim();
            if (geoCode && map[geoCode] && (!currentDesign || currentDesign.length < 5)) {
              return { ...layer, layerDesign: map[geoCode] };
            }
            return layer;
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
    input.click();
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
      const rawResult = await extractDataFromFile(normalized.base64, normalized.mime, apiKey);

      // Tự động tra cứu (VLOOKUP) mô tả địa chất dựa trên mã địa chất thực tế
      const map = rawResult.designLayerMap || {};
      const normalizedLayers = (rawResult.layers || []).map(layer => {
        const geoCode = (layer.actualGeology || '').trim();
        const currentDesign = (layer.layerDesign || '').trim();
        
        if (geoCode && map[geoCode]) {
          if (!currentDesign || currentDesign.length < 5 || currentDesign !== map[geoCode]) {
            return { ...layer, layerDesign: map[geoCode] };
          }
        }
        return layer;
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
        return (gc - 1) % GROUP_COLORS.length;
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
        ['Biên bản số', result.reportNumber], ['Đường kính', result.diameter],
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
          layer.actualGeology, result.diameter, layer.layerDesign,
          layer.timeFrom + (layer.dateFrom ? '\n' + layer.dateFrom : ''),
          layer.timeTo + (layer.dateTo ? '\n' + layer.dateTo : ''),
          layer.elevationFrom, layer.elevationTo,
          parseFloat(layer.durationHours.toFixed(2)),
          parseFloat(layer.lengthMeters.toFixed(2)),
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
        const ci2 = (gc2 - 1) % GROUP_COLORS.length;
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
        const vals2 = [i + 1, result.diameter, g.layerDesign, g.segments, parseFloat(g.elevationFrom.toFixed(2)), parseFloat(g.elevationTo.toFixed(2)), parseFloat(g.totalDuration.toFixed(2)), parseFloat(g.totalLength.toFixed(2)), parseFloat(g.avgSpeed.toFixed(2))];
        const r2 = ws2.addRow(vals2);
        r2.height = 32;
        vals2.forEach((v, ci) => {
          const isSpd = ci === 8;
          applyCell(r2.getCell(ci + 1), v, { bg: isSpd ? spdBg : bg, fontColor: isSpd ? (isSlowSpd ? 'FFFFFF' : 'C2410C') : fontColor, bold: isSpd && isSlowSpd, align: ci === 2 ? 'left' : 'center', wrap: ci === 2, border: thinBorder() });
        });
      });

      // Dòng tổng
      const totVals = ['TỔNG CỘNG', '', '', result.layers.length,
        result.layers.length > 0 ? parseFloat(result.layers[0].elevationFrom.toFixed(2)) : '',
        result.layers.length > 0 ? parseFloat(result.layers[result.layers.length - 1].elevationTo.toFixed(2)) : '',
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

  const updateField = (field: keyof ExtractionResult, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
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
    
    // Recalculate duration and speed if times or elevations change
    if (['timeFrom', 'timeTo', 'elevationFrom', 'elevationTo'].includes(field as string)) {
      const layer = newLayers[idx];
      
      // Parse times
      const startMinutes = parseTimeToMinutes(layer.timeFrom);
      const endMinutes = parseTimeToMinutes(layer.timeTo);
      
      if (startMinutes !== 0 || endMinutes !== 0) {
        let durationMinutes = endMinutes - startMinutes;
        if (durationMinutes < 0) durationMinutes += 24 * 60;
        if (durationMinutes <= 0) durationMinutes = 30; 
        layer.durationHours = durationMinutes / 60;
      }
      
      const elevStart = parseFloat(layer.elevationFrom.toString().replace(',', '.'));
      const elevEnd = parseFloat(layer.elevationTo.toString().replace(',', '.'));
      if (!isNaN(elevStart) && !isNaN(elevEnd)) {
        layer.lengthMeters = Math.abs(elevEnd - elevStart);
        if (layer.durationHours > 0) {
          layer.speedMph = layer.lengthMeters / layer.durationHours;
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

  const removeLayer = (idx: number) => {
    if (data.layers.length <= 1) return;
    const newLayers = data.layers.filter((_, i) => i !== idx).map((l, i) => ({ ...l, layerNumber: i + 1 }));
    setData(prev => ({ ...prev, layers: newLayers }));
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
            onClick={() => onSave(data)}
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
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Biên bản số</label>
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
                onBlur={(e) => updateField('constructionStart', expandYear(e.target.value))}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
                placeholder="HH:mm dd/mm/yyyy"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Kết thúc thi công</label>
              <input 
                value={data.constructionEnd} 
                onChange={(e) => updateField('constructionEnd', e.target.value)}
                onBlur={(e) => updateField('constructionEnd', expandYear(e.target.value))}
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
              </h4>
            </div>
            <div className="overflow-hidden border border-slate-300 rounded-xl shadow-sm bg-white">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full border-collapse table-auto">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300">
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'60px'}}>ĐỊA CHẤT <br/> THỰC TẾ</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Đường kính</th>
                      <th className="px-2 py-2 text-left text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300" style={{minWidth:'220px'}}>Mô tả lớp thiết kế</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Từ (h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Đến (h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Cao độ từ</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Cao độ đến</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>T.Gian</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'75px'}}>Dài (m)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'75px'}}>V (m/h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider whitespace-nowrap" style={{width:'150px'}}>Ghi chú</th>
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
                        return (groupCount - 1) % groupColors.length;
                      });
                      return data.layers.map((layer, idx) => {
                        const { row: rowBg, text: rowText } = groupColors[rowColorIdx[idx]];
                        return (
                      <tr key={idx} className={`group transition-colors hover:opacity-90`}>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`} style={{width:'60px'}}>
                          <div className="flex flex-col items-center px-1 py-1">
                            <input 
                              value={layer.actualGeology ?? ''} 
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
                          <input 
                            type="text"
                            value={layer.elevationFrom.toString().replace('.', ',')} 
                            onChange={(e) => updateLayer(idx, 'elevationFrom', e.target.value.replace(',', '.'))}
                            className="bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-2 py-1 outline-none text-center transition-all"
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle whitespace-nowrap ${rowBg}`}>
                          <input 
                            type="text"
                            value={layer.elevationTo.toString().replace('.', ',')} 
                            onChange={(e) => updateLayer(idx, 'elevationTo', e.target.value.replace(',', '.'))}
                            className="bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-2 py-1 outline-none text-center transition-all"
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`px-2 py-1 text-[12px] font-normal text-black text-center ${rowBg} border-r border-slate-200 align-middle whitespace-nowrap`}>
                          {formatNumber(layer.durationHours)}
                        </td>
                        <td className={`px-2 py-1 text-[12px] font-normal text-black text-center ${rowBg} border-r border-slate-200 align-middle whitespace-nowrap`}>
                          {formatNumber(layer.lengthMeters)}
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
                        const colorIdx = (groupCount - 1) % groupColors.length;
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
