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
  RotateCw
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
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
  _base64?: string;   // Tạm lưu để upload GitHub khi xác nhận
  _mimeType?: string;
}

interface ProcessingFile {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  result?: ExtractionResult;
  error?: string;
}

type AppSheet = 'upload' | 'summary' | 'pdf-splitter';

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
  const dmyMatch = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  const ymdMatch = s.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (dmyMatch) {
    day   = dmyMatch[1].padStart(2, '0');
    month = dmyMatch[2].padStart(2, '0');
    year  = dmyMatch[3];
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

2. ĐỊA TẦNG:
   - Tìm bảng "Lớp thiết kế" để lấy mô tả cho "designLayerMap".
   - Cột "Địa chất thực tế" có dạng "X (Y)": X là designLayerCode, Y là layerNumber.
   - "layerDesign" PHẢI khớp với mô tả của lớp X trong bảng tra cứu.

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
                actualGeology: { type: Type.STRING },
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

  // Post-process: đảm bảo layerDesign nhất quán theo designLayerCode
  // Ưu tiên 1: designLayerMap do AI tạo ra (bảng tra cứu chính xác nhất)
  // Ưu tiên 2: first-occurrence từ layers (fallback)
  const aiLayerMap: Record<string, string> = {};
  if (rawData.designLayerMap && typeof rawData.designLayerMap === 'object') {
    Object.entries(rawData.designLayerMap).forEach(([code, desc]) => {
      if (code && desc) aiLayerMap[code.toString().trim()] = desc as string;
    });
  }

  // Fallback: lấy first-occurrence từ layers nếu AI map thiếu
  const layerDesignMap: Record<string, string> = { ...aiLayerMap };
  rawData.layers.forEach((layer: any) => {
    const code = layer.designLayerCode?.toString().trim() || '';
    if (code && !layerDesignMap[code] && layer.layerDesign) {
      layerDesignMap[code] = layer.layerDesign;
    }
  });

  const processedLayers = rawData.layers.map((layer: any) => {
    const startMinutes = parseTimeToMinutes(layer.timeFrom);
    const endMinutes = parseTimeToMinutes(layer.timeTo);
    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes < 0) durationMinutes += 24 * 60;
    if (durationMinutes <= 0) durationMinutes = 30; 
    const durationHours = durationMinutes / 60;
    const length = Math.abs(layer.elevationTo - layer.elevationFrom);
    const speed = durationHours > 0 ? length / durationHours : 0;

    const code = layer.designLayerCode?.toString().trim() || '';
    // Gán lại layerDesign nhất quán theo designLayerCode
    const consistentLayerDesign = (code && layerDesignMap[code]) ? layerDesignMap[code] : layer.layerDesign;

    // Giữ nguyên actualGeology từ AI (đã yêu cầu lấy full "1 (1)")
    const cleanGeo = (layer.actualGeology || '').toString().trim();

    return {
      ...layer,
      actualGeology: cleanGeo,
      designLayerCode: code,
      layerDesign: consistentLayerDesign,
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

export default function App() {
  const [activeSheet, setActiveSheet] = useState<AppSheet>('upload');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<ExtractionResult | null>(null);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [pendingResults, setPendingResults] = useState<ExtractionResult[]>([]);
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

  // Bộ lọc Sheet 1
  const [filterProject, setFilterProject] = useState('');
  const [filterItem, setFilterItem] = useState('');
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
      // Load from localStorage first for offline feel
      const savedHistory = localStorage.getItem('pile_drill_history');
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error("Failed to load history", e);
        }
      }

      const savedApiKey = localStorage.getItem('gemini_api_key');
      if (savedApiKey) {
        setUserApiKey(savedApiKey);
      }

      const savedLogo = localStorage.getItem('pile_drill_custom_logo');
      if (savedLogo) {
        setCustomLogo(savedLogo);
      }

      // Sync with Supabase if available
      if (supabase) {
        try {
          // 1. Sync History
          const { data: historyData, error: historyError } = await supabase
            .from('drill_extractions')
            .select('*')
            .order('timestamp', { ascending: false });
          
          if (!historyError && historyData) {
            setHistory(historyData);
            localStorage.setItem('pile_drill_history', JSON.stringify(historyData));
          }

          // 2. Sync Settings (API Key & Logo)
          const { data: settingsData, error: settingsError } = await supabase
            .from('app_settings')
            .select('*');

          if (!settingsError && settingsData) {
            const apiKeySetting = settingsData.find(s => s.id === 'gemini_api_key');
            const logoSetting = settingsData.find(s => s.id === 'app_logo');

            if (apiKeySetting && apiKeySetting.value) {
              setUserApiKey(apiKeySetting.value);
              localStorage.setItem('gemini_api_key', apiKeySetting.value);
            }
            if (logoSetting && logoSetting.value) {
              setCustomLogo(logoSetting.value);
              localStorage.setItem('pile_drill_custom_logo', logoSetting.value);
            }
          }
        } catch (e) {
          console.error("Supabase sync failed", e);
        }
      }
    };

    loadData();

    const checkGithubStatus = async () => {
      // Ưu tiên đọc từ Supabase app_settings (hoạt động trên Cloudflare Pages)
      if (supabase) {
        try {
          const { data } = await supabase.from('app_settings').select('*');
          if (data) {
            const token = data.find((s: any) => s.id === 'github_token')?.value || '';
            const username = data.find((s: any) => s.id === 'github_username')?.value || '';
            const repo = data.find((s: any) => s.id === 'github_repo')?.value || 'construction-reports';
            if (token && username) {
              setGithubCreds({ token, username, repo });
              setGithubTokenInput(token);
              setGithubUsernameInput(username);
              setGithubRepoInput(repo);
              setIsGithubConnected(true);
              return;
            }
          }
        } catch (e) {
          console.error("Failed to load GitHub creds from Supabase", e);
        }
      }

      // Fallback: check server endpoint
      try {
        const res = await fetch('/api/auth/github/status');
        if (res.ok) {
          const data = await res.json();
          setIsGithubConnected(data.connected);
        }
      } catch (e) {
        console.error("Failed to check GitHub status", e);
      }
    };
    checkGithubStatus();

    // Periodic check every 5 minutes
    const statusInterval = setInterval(checkGithubStatus, 300000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        setIsGithubConnected(true);
        setIsConnectingGithub(false);
      }
    };
    window.addEventListener('message', handleMessage);

    // 3. Realtime Subscription for Settings
    let settingsSubscription: any = null;
    if (supabase) {
      settingsSubscription = supabase
        .channel('public:app_settings')
        .on('postgres_changes', { event: '*', table: 'app_settings', schema: 'public' }, (payload) => {
          const { id, value } = payload.new as any;
          if (id === 'gemini_api_key') {
            setUserApiKey(value);
            localStorage.setItem('gemini_api_key', value);
          } else if (id === 'app_logo') {
            setCustomLogo(value || null);
            if (value) {
              localStorage.setItem('pile_drill_custom_logo', value);
            } else {
              localStorage.removeItem('pile_drill_custom_logo');
            }
          }
        })
        .subscribe();
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(statusInterval);
      if (settingsSubscription) {
        supabase?.removeChannel(settingsSubscription);
      }
    };
  }, []);

  // Save history to localStorage với debounce 500ms tránh ghi liên tục
  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('pile_drill_history', JSON.stringify(history));
    }, 500);
    return () => clearTimeout(timer);
  }, [history]);

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
    
    // Save to Supabase
    if (supabase) {
      try {
        await supabase
          .from('app_settings')
          .upsert({ id: 'gemini_api_key', value: key, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to save API key to Supabase", e);
      }
    }
    
    setIsSettingsOpen(false);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setCustomLogo(base64);
      localStorage.setItem('pile_drill_custom_logo', base64);
      
      // Save to Supabase
      if (supabase) {
        try {
          await supabase
            .from('app_settings')
            .upsert({ id: 'app_logo', value: base64, updated_at: new Date().toISOString() });
        } catch (e) {
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

    const processFile = async (pFile: ProcessingFile, file: File) => {
      setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'processing', progress: 10 } : f));

      try {
        const getBase64 = (file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
        };

        const compressImage = (file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
              const img = new Image();
              img.src = event.target?.result as string;
              img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 2000;
                const MAX_HEIGHT = 2000;
                let width = img.width;
                let height = img.height;
                if (width > height) {
                  if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                } else {
                  if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
              };
              img.onerror = reject;
            };
            reader.onerror = reject;
          });
        };

        let base64 = "";
        let mimeType = file.type;

        if (file.type === "application/pdf") {
          base64 = await getBase64(file);
        } else if (file.type.startsWith("image/")) {
          base64 = await compressImage(file);
          mimeType = "image/jpeg"; // Standardize to jpeg after compression
        } else {
          throw new Error("Định dạng tệp không được hỗ trợ. Vui lòng sử dụng ảnh hoặc PDF.");
        }

        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 40 } : f));

        const rawResult = await extractDataFromFile(base64, mimeType, userApiKey);
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 80 } : f));

        const result: ExtractionResult = {
          ...rawResult,
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          fileName: file.name,
          _base64: base64,      // Lưu tạm để upload GitHub sau khi xác nhận
          _mimeType: mimeType,
        };

        // Tự động lưu ngay sau khi quét xong
        collectedResults.push(result);
        setPendingResults(prev => [result, ...prev]);
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'completed', progress: 100, result } : f));

      } catch (err: any) {
        console.error(err);
        const errorMessage = err.message || "Đã xảy ra lỗi không xác định";
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'error', error: errorMessage } : f));
      }
    };

    // Chờ tất cả file xử lý xong
    for (let i = 0; i < Array.from(files).length; i++) {
      await processFile(newFiles[i], Array.from(files)[i]);
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

  const saveResult = async (result: ExtractionResult) => {
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

          const ghRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token.trim()}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: `Upload ${finalResult.fileName} via SGC-CKN Web`, content })
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

    // 2. Lưu vào Supabase
    if (supabase) {
      try {
        const { id, _base64, _mimeType, designLayerMap, ...dataToSave } = finalResult as any;
        const { error: supabaseError } = await supabase.from('drill_extractions').insert([dataToSave]);
        if (supabaseError) {
          alert("❌ Lỗi khi lưu vào Supabase: " + supabaseError.message);
          return;
        }
      } catch (e: any) {
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
    
    setIsProcessing(true);
    const resultsToSave = [...pendingResults];
    
    for (const r of resultsToSave) {
      await saveResult(r);
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
    if (!window.confirm("Bạn có chắc chắn muốn xóa?\n\nDữ liệu trên Supabase và file trên GitHub sẽ bị xóa vĩnh viễn.")) return;

    const itemToDelete = history.find(item => item.id === id);

    // ✅ Optimistic UI: cập nhật giao diện NGAY LẬP TỨC
    setHistory(prev => prev.filter(item => item.id !== id));
    if (currentResult?.id === id) setCurrentResult(null);

    // Gọi API ngầm (không chặn UI)
    (async () => {
      // 1. Xóa Supabase
      if (supabase) {
        try {
          const { error } = await supabase.from('drill_extractions').delete().eq('id', id);
          if (error) console.error("Lỗi xóa Supabase:", error.message);
        } catch (e: any) {
          console.error("Lỗi kết nối Supabase:", e?.message);
        }
      }

      // 2. Xóa file GitHub
      if (itemToDelete?.fileUrl) {
        try {
          // Thử xóa qua backend trước (nếu có)
          try {
            const delRes = await fetch('/api/github/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileUrl: itemToDelete.fileUrl })
            });
            if (delRes.ok) {
              console.log("Đã xóa file GitHub qua backend");
              return;
            }
          } catch (_) {}

          // Fallback xóa trực tiếp từ client nếu backend thất bại hoặc không cấu hình
          const creds = githubCreds;
          if (creds?.token && creds?.username) {
            const { token, username, repo } = creds;
            // Loại bỏ query string nếu có
            const cleanUrl = itemToDelete.fileUrl.split('?')[0];
            const decodedUrl = decodeURIComponent(cleanUrl);
            
            let path = "";
            if (decodedUrl.includes('raw.githubusercontent.com')) {
              const match = decodedUrl.match(/https:\/\/raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/[^\/]+\/(.+)/);
              if (match) path = match[1];
            } else if (decodedUrl.includes('github.com')) {
              const match = decodedUrl.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/blob\/[^\/]+\/(.+)/);
              if (match) path = match[1];
            }

            if (path) {
              const getRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
                headers: { 
                  'Authorization': `token ${token.trim()}`, 
                  'Accept': 'application/vnd.github.v3+json' 
                }
              });
              if (getRes.ok) {
                const fileData = await getRes.json();
                await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
                  method: 'DELETE',
                  headers: { 
                    'Authorization': `token ${token.trim()}`, 
                    'Accept': 'application/vnd.github.v3+json', 
                    'Content-Type': 'application/json' 
                  },
                  body: JSON.stringify({ 
                    message: `Delete construction report: ${path}`, 
                    sha: fileData.sha 
                  })
                });
                console.log("Đã xóa file GitHub qua client");
              }
            }
          }
        } catch (e: any) {
          console.error("Lỗi xóa GitHub:", e?.message);
        }
      }
    })();
  };

  const handleEdit = (result: ExtractionResult) => {
    setEditingResult(JSON.parse(JSON.stringify(result)));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = (updatedResult: ExtractionResult) => {
    // ✅ Optimistic UI: cập nhật giao diện NGAY LẬP TỨC
    setHistory(prev => prev.map(item => item.id === updatedResult.id ? updatedResult : item));
    setIsEditModalOpen(false);
    setEditingResult(null);

    // Gọi API ngầm (không chặn UI)
    if (supabase) {
      (async () => {
        try {
          const { designLayerMap: _dlm, ...updateData } = updatedResult as any;
          const { error } = await supabase.from('drill_extractions').update(updateData).eq('id', updatedResult.id);
          if (error) console.error("Lỗi cập nhật Supabase:", error.message);
        } catch (e: any) {
          console.error("Lỗi kết nối Supabase:", e?.message);
        }
      })();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans overflow-x-hidden">
      {/* Sidebar Overlay */}
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
              <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-sm border border-[#1e4070]">
                {customLogo ? (
                  <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                    <Construction className="text-white w-5 h-5" />
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
            <p className="text-[10px] font-bold text-blue-300/70 uppercase tracking-widest mb-4 px-4">Danh mục chính</p>
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
      <header className="border-b border-[#1e3a5f] px-5 py-1.5 flex items-center justify-between sticky top-0 z-30 text-white min-h-[48px]" style={{ background: "#1a3a6b" }}>
        <div 
          className="flex items-center gap-3 cursor-pointer group"
          onMouseEnter={() => setIsSidebarOpen(true)}
          onClick={() => setIsSidebarOpen(true)}
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shadow-md group-hover:scale-105 transition-transform border border-blue-700 bg-white">
            {customLogo ? (
              <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                <Construction className="text-white w-5 h-5" />
              </div>
            )}
          </div>
          <div>
            <h1 className="text-[18px] font-black tracking-tight text-white uppercase leading-none">SGC - CKN</h1>
            <p className="text-[9px] text-blue-300 font-bold uppercase tracking-[0.2em] mt-0.5">
              Construction Management
            </p>
          </div>
          <div className="ml-1 p-1.5 bg-white/10 rounded-lg text-blue-300 group-hover:text-white transition-colors">
            <Menu size={16} />
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {activeSheet === 'upload' && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-orange-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-orange-600 transition-all flex items-center gap-2 shadow-md shadow-orange-900/30 uppercase tracking-wider border border-orange-400/20"
            >
              <Upload size={14} />
              Up File
            </button>
          )}
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
            {history.length > 0 && !currentResult && (() => {
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

              const filtered = history.filter(item => {
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

              const hasActiveFilter = filterProject || filterItem || filterComponentName || filterReportNumber || filterDiameter || filterDateFrom || filterDateTo;

              const resetFilters = () => {
                setFilterProject(''); setFilterItem(''); setFilterComponentName('');
                setFilterReportNumber(''); setFilterDiameter('');
                setFilterDateFrom(''); setFilterDateTo('');
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
                      onClick={() => setShowFilters(p => !p)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                        showFilters
                          ? "bg-blue-600 text-white border-blue-600 shadow-md"
                          : "bg-white text-blue-900 border-slate-200 hover:border-blue-400"
                      )}
                    >
                      <Filter size={13} />
                      Bộ lọc
                      {hasActiveFilter && (
                        <span className="bg-orange-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                          {[filterProject, filterItem, filterComponentName, filterReportNumber, filterDiameter, filterDateFrom, filterDateTo].filter(Boolean).length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setActiveSheet('summary')}
                      className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-widest transition-colors"
                    >
                      Dashboard →
                    </button>
                  </div>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                  <div className="rounded-2xl border border-[#1e3a5f] shadow-md animate-in fade-in slide-in-from-top-2 duration-200" style={{ background: 'linear-gradient(160deg, #1a3a6b 0%, #1e4480 50%, #163570 100%)', overflow: 'visible' }}>
                    <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" style={{ overflow: 'visible' }}>
                      {/* Dự án - Dropdown + Search */}
                      {(() => {
                        const opts = [...new Set(history.map(r => r.project).filter(Boolean))].sort();
                        const matched = opts.filter(p => p.toLowerCase().includes(filterProject.toLowerCase()));
                        return (
                          <div className="space-y-1.5 relative" ref={projectDropdownRef}>
                            <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Dự án</label>
                            <div className={cn("relative border rounded-xl transition-all bg-white/10 focus-within:bg-white/20", showProjectDropdown ? "border-blue-300" : "border-white/20")}>
                              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
                              <input value={filterProject} onChange={e => { setFilterProject(e.target.value); setShowProjectDropdown(true); }} onFocus={() => setShowProjectDropdown(true)}
                                placeholder="Gõ để lọc dự án..."
                                className="w-full pl-8 pr-14 py-2 text-[12px] bg-transparent outline-none rounded-xl text-white placeholder-blue-300/60" />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {filterProject && <button onClick={() => { setFilterProject(''); setShowProjectDropdown(false); }} className="text-blue-300 hover:text-red-300 transition-colors"><X size={12} /></button>}
                                <button onClick={() => setShowProjectDropdown(p => !p)} className="text-blue-300 hover:text-white transition-colors"><ChevronDown size={13} className={cn("transition-transform", showProjectDropdown && "rotate-180")} /></button>
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
                          <div className="space-y-1.5 relative" ref={itemDropdownRef}>
                            <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Hạng mục</label>
                            <div className={cn("relative border rounded-xl transition-all bg-white/10 focus-within:bg-white/20", showItemDropdown ? "border-blue-300" : "border-white/20")}>
                              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
                              <input value={filterItem} onChange={e => { setFilterItem(e.target.value); setShowItemDropdown(true); }} onFocus={() => setShowItemDropdown(true)}
                                placeholder="Gõ để lọc hạng mục..."
                                className="w-full pl-8 pr-14 py-2 text-[12px] bg-transparent outline-none rounded-xl text-white placeholder-blue-300/60" />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {filterItem && <button onClick={() => { setFilterItem(''); setShowItemDropdown(false); }} className="text-blue-300 hover:text-red-300 transition-colors"><X size={12} /></button>}
                                <button onClick={() => setShowItemDropdown(p => !p)} className="text-blue-300 hover:text-white transition-colors"><ChevronDown size={13} className={cn("transition-transform", showItemDropdown && "rotate-180")} /></button>
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
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Tên bộ phận</label>
                        <div className="relative border border-white/20 rounded-xl bg-white/10 focus-within:bg-white/20 focus-within:border-blue-300 transition-all">
                          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
                          <input value={filterComponentName} onChange={e => setFilterComponentName(e.target.value)} placeholder="Gõ để lọc tên bộ phận..."
                            className="w-full pl-8 pr-8 py-2 text-[12px] bg-transparent outline-none rounded-xl text-white placeholder-blue-300/60" />
                          {filterComponentName && <button onClick={() => setFilterComponentName('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-300 hover:text-red-300 transition-colors"><X size={12} /></button>}
                        </div>
                      </div>
                      {/* Biên bản số */}
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Biên bản số</label>
                        <div className="relative border border-white/20 rounded-xl bg-white/10 focus-within:bg-white/20 focus-within:border-blue-300 transition-all">
                          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
                          <input value={filterReportNumber} onChange={e => setFilterReportNumber(e.target.value)} placeholder="Gõ để lọc biên bản..."
                            className="w-full pl-8 pr-8 py-2 text-[12px] bg-transparent outline-none rounded-xl text-white placeholder-blue-300/60" />
                          {filterReportNumber && <button onClick={() => setFilterReportNumber('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-300 hover:text-red-300 transition-colors"><X size={12} /></button>}
                        </div>
                      </div>
                      {/* Đường kính - Dropdown + Search */}
                      {(() => {
                        const opts = [...new Set(history.map(r => r.diameter).filter(Boolean))].sort();
                        const matched = opts.filter(p => p.toLowerCase().includes(filterDiameter.toLowerCase()));
                        return (
                          <div className="space-y-1.5 relative" ref={diameterDropdownRef}>
                            <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Đường kính</label>
                            <div className={cn("relative border rounded-xl transition-all bg-white/10 focus-within:bg-white/20", showDiameterDropdown ? "border-blue-300" : "border-white/20")}>
                              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
                              <input value={filterDiameter} onChange={e => { setFilterDiameter(e.target.value); setShowDiameterDropdown(true); }} onFocus={() => setShowDiameterDropdown(true)}
                                placeholder="Gõ để lọc đường kính..."
                                className="w-full pl-8 pr-14 py-2 text-[12px] bg-transparent outline-none rounded-xl text-white placeholder-blue-300/60" />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                {filterDiameter && <button onClick={() => { setFilterDiameter(''); setShowDiameterDropdown(false); }} className="text-blue-300 hover:text-red-300 transition-colors"><X size={12} /></button>}
                                <button onClick={() => setShowDiameterDropdown(p => !p)} className="text-blue-300 hover:text-white transition-colors"><ChevronDown size={13} className={cn("transition-transform", showDiameterDropdown && "rotate-180")} /></button>
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
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Ngày kết thúc từ</label>
                        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                          className="w-full px-3 py-2 text-[12px] border border-white/20 rounded-xl bg-white/10 focus:bg-white/20 focus:border-blue-300 outline-none transition-all text-white [color-scheme:dark]" />
                      </div>
                      {/* Ngày kết thúc đến */}
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-black text-blue-200 uppercase tracking-widest">Ngày kết thúc đến</label>
                        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                          className="w-full px-3 py-2 text-[12px] border border-white/20 rounded-xl bg-white/10 focus:bg-white/20 focus:border-blue-300 outline-none transition-all text-white [color-scheme:dark]" />
                      </div>
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
                          <th className="text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={13} className="text-center py-16 text-slate-400">
                              <div className="flex flex-col items-center gap-3">
                                <Search size={32} className="opacity-30" />
                                <p className="text-sm font-bold uppercase tracking-widest">Không tìm thấy kết quả</p>
                                <button onClick={resetFilters} className="text-[10px] font-black text-blue-500 hover:underline uppercase tracking-widest">Xóa bộ lọc</button>
                              </div>
                            </td>
                          </tr>
                        ) : filtered.map((item, index) => (
                          <tr key={item.id} className="hover:bg-sky-50/80 transition-colors group">
                            <td className="text-center font-bold text-blue-700 text-xs">{filtered.length - index}</td>
                            <td className="font-normal text-blue-900">{item.project}</td>
                            <td className="text-slate-900 font-normal">{item.item}</td>
                            <td className="text-slate-900 font-normal">{item.componentName}</td>
                            <td className="font-normal text-blue-900 text-center">{item.pileId}</td>
                            <td className="font-normal text-slate-900">{item.reportNumber}</td>
                            <td className="font-normal text-slate-900 text-center">{item.diameter}</td>
                            <td className="text-slate-900 font-normal text-center">{item.constructionStart}</td>
                            <td className="text-slate-900 font-normal text-center">{item.constructionEnd}</td>
                            <td className="text-center font-bold text-orange-600">
                              {formatNumber(item.layers.reduce((acc, l) => acc + l.lengthMeters, 0))}
                            </td>
                            <td className="text-center text-slate-700">
                              {(() => {
                                const h = item.layers.reduce((acc, l) => acc + l.durationHours, 0);
                                return h > 0 ? formatNumber(h) : '—';
                              })()}
                            </td>
                            <td className="text-center">
                              {(() => {
                                const totalLen = item.layers.reduce((acc, l) => acc + l.lengthMeters, 0);
                                const h = item.layers.reduce((acc, l) => acc + l.durationHours, 0);
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
            })()}
          </div>
            )} {/* end else: không có file */}
          </div>
        ) : activeSheet === 'pdf-splitter' ? (
          <PdfSplitterView />
        ) : (
          <SummaryView 
            history={history} 
            onSelectResult={(res) => { setCurrentResult(res); setActiveSheet('upload'); }} 
            onEdit={handleEdit}
            onDelete={handleDelete}
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

      {/* Edit Split View Modal */}
      {isEditModalOpen && editingResult && (
        <EditSplitView 
          result={editingResult} 
          onClose={() => { setIsEditModalOpen(false); setEditingResult(null); }}
          onSave={handleSaveEdit}
          githubCreds={githubCreds}
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
        <StatCard title="Tổng chiều sâu" value={`${formatNumber(result.layers.reduce((acc, l) => acc + l.lengthMeters, 0))} m`} icon={<ArrowDownToLine className="text-orange-600" />} />
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
            {result.layers.length} Lớp
          </div>
          <div className="px-3 py-1.5 bg-slate-50 text-black rounded-lg text-[10px] font-bold uppercase tracking-widest border border-slate-300">
            TB: {formatNumber(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length)} m/h
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
              {formatNumber(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length)}
            </span>
            <span className="text-slate-900 font-bold uppercase tracking-widest text-xs">m/h</span>
          </div>
          <div className="mt-8 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 transition-all duration-1000" 
              style={{ width: `${Math.min(100, (result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length) * 10)}%` }} 
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
  onDelete 
}: { 
  history: ExtractionResult[], 
  onSelectResult: (res: ExtractionResult) => void,
  onEdit: (res: ExtractionResult) => void,
  onDelete: (id: string) => void
}) {
  const projects = [...new Set(history.map(r => r.project).filter(Boolean))];
  const totalPiles = history.length;
  const totalDepth = history.reduce((acc, r) => acc + r.layers.reduce((s, l) => s + l.lengthMeters, 0), 0);
  const avgSpeed = history.length > 0
    ? history.reduce((acc, r) => acc + (r.layers.reduce((s, l) => s + l.speedMph, 0) / (r.layers.length || 1)), 0) / history.length
    : 0;

  // Tìm các cọc có vận tốc khoan < 1m/h
  const slowPiles = history.filter(r => 
    r.layers.some(l => l.speedMph > 0 && l.speedMph < 1)

  );

  // ── Phát hiện trùng lặp (Hạng mục + Số hiệu cọc) ──
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
    const key = `${componentName}|||${pileId}`;
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

  if (history.length === 0) return (
    <div className="flex flex-col items-center justify-center py-40 text-center animate-in fade-in duration-500">
      <div className="bg-slate-100 p-8 rounded-full mb-6"><BarChart3 className="text-slate-300 w-12 h-12" /></div>
      <h4 className="text-lg font-black text-slate-400 uppercase tracking-widest">Chưa có dữ liệu</h4>
      <p className="text-slate-400 mt-2 text-sm">Hãy upload biên bản để xem Dashboard</p>
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
}: { 
  result: ExtractionResult; 
  onClose: () => void; 
  onSave: (res: ExtractionResult) => void;
  embedded?: boolean;
  githubCreds?: { token: string; username: string; repo: string } | null;
}) {
  const [data, setData] = useState<ExtractionResult>(result);
  const [zoom, setZoom] = useState(1);
  const [isFetchingImage, setIsFetchingImage] = useState(false);

  // Màu nền cho từng nhóm lớp (khớp với bảng hiển thị)
  const GROUP_COLORS = [
    { bg: 'BFDFFF', font: '0D3B6E' }, // sky-200
    { bg: 'FDE68A', font: '78350F' }, // amber-200
    { bg: 'A7F3D0', font: '065F46' }, // emerald-200
    { bg: 'FECACA', font: '7F1D1D' }, // rose-200
    { bg: 'DDD6FE', font: '4C1D95' }, // violet-200
    { bg: 'D9F99D', font: '365314' }, // lime-200
    { bg: 'FED7AA', font: '7C2D12' }, // orange-200
    { bg: 'A5F3FC', font: '164E63' }, // cyan-200
    { bg: 'FBCFE8', font: '831843' }, // pink-200
    { bg: '99F6E4', font: '134E4A' }, // teal-200
    { bg: 'FECACA', font: '7F1D1D' }, // red-200
    { bg: 'C7D2FE', font: '312E81' }, // indigo-200
  ];

  // Tự động lấy ảnh từ GitHub Contents API (hỗ trợ CORS)
  const fetchImageFromGitHub = async (): Promise<{ base64: string; ext: string } | null> => {
    try {
      const url = data.fileUrl;
      if (!url) return null;
      const isPdf = url.toLowerCase().includes('.pdf');
      if (isPdf) return null;

      // Chuẩn hoá về raw URL
      let rawUrl = url;
      if (url.includes('github.com') && url.includes('/blob/')) {
        rawUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }

      // Xác định định dạng file
      const cleanRaw = rawUrl.split('?')[0].toLowerCase();
      const ext = cleanRaw.endsWith('.png') ? 'png' : 'jpeg';

      // Helper: chuyển ArrayBuffer → base64
      const bufferToBase64 = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      };

      // ── Chiến lược 1: Cloudflare proxy (tránh CORS, hỗ trợ token phía server) ──
      try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
        const proxyResp = await fetch(proxyUrl);
        if (proxyResp.ok) {
          const buf = await proxyResp.arrayBuffer();
          if (buf.byteLength > 0) {
            return { base64: bufferToBase64(buf), ext };
          }
        }
      } catch { /* tiếp tục chiến lược khác */ }

      // ── Chiến lược 2: Fetch trực tiếp raw URL (hoạt động với repo public) ──
      try {
        const directResp = await fetch(rawUrl, { cache: 'no-store' });
        if (directResp.ok) {
          const buf = await directResp.arrayBuffer();
          if (buf.byteLength > 0) {
            return { base64: bufferToBase64(buf), ext };
          }
        }
      } catch { /* tiếp tục chiến lược khác */ }

      // ── Chiến lược 3: GitHub Contents API (giới hạn 1MB, có token) ──
      const match = rawUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
      if (match) {
        const [, owner, repo, branch, filePath] = match;
        const token = githubCreds?.token;
        const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
        if (token) headers['Authorization'] = `token ${token}`;

        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const resp = await fetch(apiUrl, { headers });
        if (resp.ok) {
          const json = await resp.json();
          if (json.content) {
            const b64 = json.content.replace(/\n/g, '');
            return { base64: b64, ext };
          }
          // File > 1MB: dùng download_url từ API
          if (json.download_url) {
            try {
              const dlResp = await fetch(json.download_url);
              if (dlResp.ok) {
                const buf = await dlResp.arrayBuffer();
                if (buf.byteLength > 0) return { base64: bufferToBase64(buf), ext };
              }
            } catch { /* thất bại */ }
          }
        }
      }

      return null;
    } catch { return null; }
  };

  const exportToExcel = (result: ExtractionResult, imageData?: { base64: string; ext: string } | null) => {
    const loadExcelJS = (): Promise<any> => {
      return new Promise((resolve, reject) => {
        if ((window as any).ExcelJS) { resolve((window as any).ExcelJS); return; }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        script.onload = () => resolve((window as any).ExcelJS);
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

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
          titleRow.height = 20;
          applyCell(titleRow.getCell(1), 'ẢNH BIÊN BẢN GỐC', { bg: '1A3A6B', fontColor: 'FFFFFF', bold: true, sz: 12, align: 'center', border: thinBorder('1A3A6B') });
          ws1.mergeCells(startRow, 1, startRow, 11);

          ws1.addImage(imgId, {
            tl: { col: 0, row: startRow }, // bắt đầu từ cột A
            ext: { width: 900, height: 1200 }, // kích thước ảnh A4
          });
          // Giãn các dòng để chứa ảnh (~1200px / 72dpi * 72 ≈ 900pt)
          for (let i = startRow + 1; i <= startRow + 50; i++) {
            ws1.getRow(i).height = 18;
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
      a.download = `${result.componentName || 'BienBan'}_${result.pileId || ''}_${result.diameter || ''}.xlsx`.replace(/\s+/g, '_');
      a.click();
      URL.revokeObjectURL(url);
    }).catch((err) => { console.error(err); alert('Không thể tải thư viện xuất Excel. Vui lòng kiểm tra kết nối mạng.'); });
  };

  const [displayUrl, setDisplayUrl] = useState<string | null>(result.fileUrl || null);
  const [isPdf, setIsPdf] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [pickedImageData, setPickedImageData] = useState<{ base64: string; ext: string } | null>(null);
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
        setDisplayUrl(null);
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
  }, [data.fileUrl]);

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
    
    // Nếu thay đổi actualGeology dạng "1 (1)", tự động cập nhật designLayerCode và layerDesign
    if (field === 'actualGeology') {
      const val = value.toString().trim();
      const match = val.match(/^(\d+)\s*\((.*)\)$/);
      if (match) {
        const code = match[1];
        newLayers[idx].designLayerCode = code;
        // Cập nhật mô tả từ designLayerMap nếu có
        const designMap = (data as any).designLayerMap;
        if (designMap && designMap[code]) {
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
          <button
            disabled={isFetchingImage}
            onClick={async () => {
              if (isFetchingImage) return;
              setIsFetchingImage(true);
              try {
                // Thử tự lấy ảnh từ GitHub trước
                const autoImg = await fetchImageFromGitHub();
                if (autoImg) {
                  // Có ảnh tự động → xuất luôn
                  exportToExcel(data, autoImg);
                } else {
                  // Không lấy được (PDF hoặc lỗi) → mở dialog chọn tay
                  setShowImagePicker(true);
                }
              } finally {
                setIsFetchingImage(false);
              }
            }}
            className={`px-4 py-2 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors border flex items-center gap-2 ${isFetchingImage ? 'bg-emerald-300 border-emerald-200 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-600 border-emerald-400'}`}
          >
            {isFetchingImage ? (
              <><svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Đang lấy ảnh...</>
            ) : (
              <><ArrowDownToLine size={14} /> Xuất Excel</>
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

      {/* Dialog chọn ảnh biên bản trước khi xuất Excel */}
      {showImagePicker && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-[440px] space-y-5">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 p-2 rounded-xl"><ArrowDownToLine size={20} className="text-emerald-600" /></div>
              <div>
                <h3 className="font-black text-slate-900 text-base">Xuất File Excel</h3>
                <p className="text-xs text-slate-500">Đính kèm ảnh biên bản vào sheet Excel</p>
              </div>
            </div>

            <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center space-y-3 hover:border-emerald-400 transition-colors cursor-pointer"
              onClick={() => document.getElementById('excel-img-picker')?.click()}
            >
              {pickedImageData ? (
                <div className="space-y-2">
                  <div className="w-full h-32 bg-slate-100 rounded-lg overflow-hidden">
                    <img src={`data:image/${pickedImageData.ext};base64,${pickedImageData.base64}`} className="w-full h-full object-contain" />
                  </div>
                  <p className="text-xs text-emerald-600 font-bold">✓ Đã chọn ảnh — click để đổi ảnh khác</p>
                </div>
              ) : (
                <div className="space-y-2 py-4">
                  <div className="text-3xl">🖼️</div>
                  <p className="text-sm font-bold text-slate-700">Click để chọn ảnh biên bản</p>
                  <p className="text-xs text-slate-400">JPG, PNG, WEBP — ảnh chụp biên bản gốc</p>
                </div>
              )}
              <input id="excel-img-picker" type="file" accept="image/*" className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const full = reader.result as string;
                    const ext = file.type.includes('png') ? 'png' : 'jpeg';
                    setPickedImageData({ base64: full.split(',')[1], ext });
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setShowImagePicker(false); setPickedImageData(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
                Bỏ qua, không cần ảnh
              </button>
              <button onClick={() => { setShowImagePicker(false); exportToExcel(data, pickedImageData); setPickedImageData(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-black transition-colors flex items-center justify-center gap-2">
                <ArrowDownToLine size={15} />
                Xuất Excel
              </button>
            </div>
          </div>
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
