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
  BarChart2
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './supabase';
import { Document, Page, pdfjs } from 'react-pdf';
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
  diameter: string;
  constructionStart: string;
  constructionEnd: string;
  layerNumber: number;
  layerDesign: string;
  timeFrom: string;
  timeTo: string;
  dateFrom: string;
  dateTo: string;
  elevationFrom: number;
  elevationTo: number;
  actualGeology: string;
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
  diameter: string;
  constructionStart: string;
  constructionEnd: string;
  layers: DrillLayer[];
  summary: string;
  fileName?: string;
  fileUrl?: string;
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

type AppSheet = 'upload' | 'summary';

// --- Helper Functions ---

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

// --- Gemini Service ---

const extractDataFromFile = async (base64Data: string, mimeType: string, userApiKey?: string): Promise<Omit<ExtractionResult, 'id' | 'timestamp'>> => {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key không tồn tại. Vui lòng cấu hình trong phần Cài đặt.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            text: `Bạn là một chuyên gia phân tích dữ liệu xây dựng chuyên nghiệp. Hãy trích xuất dữ liệu từ hình ảnh hoặc PDF của "Biên bản theo dõi địa chất" hoặc "Nhật ký thi công cọc".

Yêu cầu trích xuất chi tiết:
1. Thông tin chung: Dự án (project), Hạng mục (item), Tên bộ phận (componentName), Số hiệu cọc (pileId), Đường kính cọc (diameter).
2. Thời gian tổng thể: Ngày/giờ bắt đầu (constructionStart) và kết thúc (constructionEnd) thi công cọc.
3. Bảng chi tiết địa chất (layers):
   - layerNumber: Số thứ tự lớp (1, 2, 3...).
   - layerDesign: Mô tả địa chất theo thiết kế (ví dụ: Sét pha, cát hạt trung...).
   - timeFrom: Giờ bắt đầu khoan lớp này (định dạng HH:mm).
   - timeTo: Giờ kết thúc khoan lớp này (định dạng HH:mm).
   - dateFrom: Ngày bắt đầu khoan lớp này (định dạng DD/MM/YYYY). Nếu không ghi rõ thì suy luận từ ngày thi công hoặc ngày của dòng gần nhất có ghi ngày.
   - dateTo: Ngày kết thúc khoan lớp này (định dạng DD/MM/YYYY). Thường giống dateFrom, trừ khi qua đêm sang ngày hôm sau.
   - elevationFrom: Cao độ bắt đầu của lớp (mét).
   - elevationTo: Cao độ kết thúc của lớp (mét).
   - actualGeology: Ký hiệu địa chất thực tế (ví dụ: 1, 1a, 2...).

4. Tóm tắt (summary): Viết một đoạn ngắn (2-3 câu) nhận xét về tiến độ và địa chất thực tế so với thiết kế.

Lưu ý quan trọng: 
- Nếu không tìm thấy dữ liệu, hãy để trống hoặc ước tính hợp lý dựa trên ngữ cảnh.
- Đảm bảo các con số cao độ là số thực.
- Trả về kết quả dưới dạng JSON chuẩn.`
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
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          project: { type: Type.STRING },
          item: { type: Type.STRING },
          componentName: { type: Type.STRING },
          pileId: { type: Type.STRING },
          diameter: { type: Type.STRING },
          constructionStart: { type: Type.STRING },
          constructionEnd: { type: Type.STRING },
          layers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                layerNumber: { type: Type.INTEGER },
                layerDesign: { type: Type.STRING },
                timeFrom: { type: Type.STRING },
                timeTo: { type: Type.STRING },
                dateFrom: { type: Type.STRING },
                dateTo: { type: Type.STRING },
                elevationFrom: { type: Type.NUMBER },
                elevationTo: { type: Type.NUMBER },
                actualGeology: { type: Type.STRING }
              },
              required: ["layerNumber", "layerDesign", "timeFrom", "timeTo", "dateFrom", "dateTo", "elevationFrom", "elevationTo", "actualGeology"]
            }
          },
          summary: { type: Type.STRING }
        },
        required: ["project", "item", "componentName", "pileId", "diameter", "constructionStart", "constructionEnd", "layers"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("Không có phản hồi từ AI");
  const rawData = JSON.parse(text);

  const processedLayers = rawData.layers.map((layer: any) => {
    const startMinutes = parseTimeToMinutes(layer.timeFrom);
    const endMinutes = parseTimeToMinutes(layer.timeTo);
    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes < 0) durationMinutes += 24 * 60;
    if (durationMinutes <= 0) durationMinutes = 30; 
    const durationHours = durationMinutes / 60;
    const length = Math.abs(layer.elevationTo - layer.elevationFrom);
    const speed = durationHours > 0 ? length / durationHours : 0;

    return {
      ...layer,
      project: rawData.project,
      item: rawData.item,
      componentName: rawData.componentName,
      pileId: rawData.pileId,
      diameter: rawData.diameter,
      constructionStart: rawData.constructionStart,
      constructionEnd: rawData.constructionEnd,
      durationHours: durationHours,
      lengthMeters: length,
      speedMph: speed
    };
  });

  return { ...rawData, layers: processedLayers };
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

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

    // Periodic check every 30 seconds
    const statusInterval = setInterval(checkGithubStatus, 30000);

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

  // Save history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('pile_drill_history', JSON.stringify(history));
  }, [history]);

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

        // KHÔNG upload GitHub hay lưu Supabase ở đây
        // Chờ người dùng xác nhận bấm "Lưu dữ liệu"

        setPendingResults(prev => [result, ...prev]);
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'completed', progress: 100, result } : f));
        
        if (files.length === 1) {
          setCurrentResult(result);
        }

      } catch (err: any) {
        console.error(err);
        const errorMessage = err.message || "Đã xảy ra lỗi không xác định";
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'error', error: errorMessage } : f));
      }
    };

    for (let i = 0; i < Array.from(files).length; i++) {
      await processFile(newFiles[i], Array.from(files)[i]);
    }

    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        const { id, _base64, _mimeType, ...dataToSave } = finalResult;
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

  const cancelResult = (id: string) => {
    setPendingResults(prev => prev.filter(r => r.id !== id));
    if (currentResult?.id === id) {
      setCurrentResult(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa?\n\nDữ liệu trên Supabase và file trên GitHub sẽ bị xóa vĩnh viễn.")) return;

    const itemToDelete = history.find(item => item.id === id);

    // 1. Xóa Supabase
    if (supabase) {
      try {
        const { error } = await supabase.from('drill_extractions').delete().eq('id', id);
        if (error) throw error;
      } catch (e: any) {
        alert("❌ Lỗi khi xóa dữ liệu trên Supabase: " + (e?.message || e));
        return;
      }
    }

    // 2. Xóa file GitHub - gọi thẳng GitHub API từ frontend
    if (itemToDelete?.fileUrl) {
      try {
        const creds = githubCreds;
        if (!creds?.token || !creds?.username) {
          console.warn("GitHub credentials not available, skipping file delete");
        } else {
          const { token, username, repo } = creds;
          const decodedUrl = decodeURIComponent(itemToDelete.fileUrl);
          let path = '';
          const match = decodedUrl.match(/https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)/);
          if (match) path = match[1];

          if (path) {
            const getRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
              headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
              }
            });

            if (getRes.ok) {
              const fileData = await getRes.json();
              const delRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `token ${token}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  message: `Delete construction report: ${path}`,
                  sha: fileData.sha
                })
              });
              if (!delRes.ok) {
                const err = await delRes.json();
                alert("⚠️ Đã xóa Supabase, nhưng xóa file GitHub thất bại: " + (err?.message || "Lỗi không xác định"));
              }
            } else {
              console.warn("File not found on GitHub, possibly already deleted");
            }
          }
        }
      } catch (e: any) {
        alert("⚠️ Đã xóa Supabase, nhưng lỗi khi xóa file GitHub: " + (e?.message || e));
      }
    }

    // 3. Cập nhật UI
    setHistory(prev => prev.filter(item => item.id !== id));
    if (currentResult?.id === id) setCurrentResult(null);
  };

  const handleEdit = (result: ExtractionResult) => {
    setEditingResult(JSON.parse(JSON.stringify(result)));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (updatedResult: ExtractionResult) => {
    if (supabase) {
      try {
        const { error } = await supabase
          .from('drill_extractions')
          .update(updatedResult)
          .eq('id', updatedResult.id);
        if (error) throw error;
      } catch (e) {
        console.error("Failed to update Supabase", e);
        alert("Lỗi khi cập nhật dữ liệu");
        return;
      }
    }

    setHistory(prev => prev.map(item => item.id === updatedResult.id ? updatedResult : item));
    setIsEditModalOpen(false);
    setEditingResult(null);
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
          "fixed top-0 left-0 h-full w-72 bg-blue-950 z-50 shadow-2xl transition-transform duration-500 ease-out transform border-r border-blue-900",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        onMouseLeave={() => setIsSidebarOpen(false)}
      >
        <div className="p-8 h-full flex flex-col">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-sm border border-blue-800">
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
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em]">Hệ thống quản lý</span>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-blue-900 rounded-lg transition-colors text-blue-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="space-y-1 flex-1">
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-4 px-4">Danh mục chính</p>
            <button 
              onClick={() => { setActiveSheet('upload'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'upload' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-900/40" 
                  : "hover:bg-blue-900 text-blue-300"
              )}
            >
              <Upload size={18} className={activeSheet === 'upload' ? "text-white" : "text-blue-400 group-hover:text-white"} />
              <span className="font-medium text-sm">Xử lý biên bản</span>
            </button>

            <button 
              onClick={() => { setActiveSheet('summary'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'summary' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-900/40" 
                  : "hover:bg-blue-900 text-blue-300"
              )}
            >
              <Database size={18} className={activeSheet === 'summary' ? "text-white" : "text-blue-400 group-hover:text-white"} />
              <span className="font-medium text-sm">Kho dữ liệu tổng hợp</span>
            </button>
          </nav>

          <div className="pt-6 border-t border-blue-900">
            <div className="bg-blue-900/60 rounded-xl p-4">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Phiên bản hiện tại</p>
              <p className="text-xs font-medium text-blue-200">v2.1.0 Professional</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="bg-blue-900 border-b border-blue-800 px-8 py-2 flex items-center justify-between sticky top-0 z-30 shadow-lg backdrop-blur-md bg-blue-900/95 text-white min-h-[64px]">
        <div 
          className="flex items-center gap-4 cursor-pointer group"
          onMouseEnter={() => setIsSidebarOpen(true)}
          onClick={() => setIsSidebarOpen(true)}
        >
          <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shadow-md group-hover:scale-105 transition-transform border border-blue-700 bg-white">
            {customLogo ? (
              <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                <Construction className="text-white w-6 h-6" />
              </div>
            )}
          </div>
          <div>
            <h1 className="text-[20px] font-black tracking-tight text-white uppercase leading-none">SGC - CKN</h1>
            <p className="text-[10px] text-blue-300 font-bold uppercase tracking-[0.25em] mt-1">
              Construction Management
            </p>
          </div>
          <div className="ml-2 p-2 bg-white/10 rounded-lg text-blue-300 group-hover:text-white transition-colors">
            <Menu size={20} />
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {activeSheet === 'upload' && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-orange-500 text-white px-8 py-3.5 rounded-2xl text-sm font-black hover:bg-orange-600 transition-all flex items-center gap-3 shadow-xl shadow-orange-900/40 uppercase tracking-widest border-2 border-orange-400/20"
            >
              <Upload size={20} />
              Up Nhật ký thi công
            </button>
          )}
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-3 bg-white/10 border border-white/10 text-white rounded-2xl hover:bg-white/20 transition-all shadow-sm"
          >
            <Settings size={22} />
          </button>
        </div>
      </header>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf" multiple onChange={handleFileUpload} />

      <main className="flex-1 p-8 w-full space-y-10">
        {activeSheet === 'upload' ? (
          <div className="w-full space-y-12">
            {/* === SPLIT-SCREEN KHI CÓ FILE ĐANG XỬ LÝ HOẶC CHỜ DUYỆT === */}
            {(processingFiles.length > 0 || pendingResults.length > 0) ? (
              <div className="flex gap-0 h-[calc(100vh-160px)] rounded-3xl overflow-hidden border border-slate-200 shadow-xl">

                {/* CỘT TRÁI: Danh sách file - thu gọn */}
                <div className="w-52 flex-shrink-0 bg-blue-950 flex flex-col">
                  <div className="px-5 py-4 border-b border-blue-900/70">
                    <div className="flex items-center gap-2">
                      <Loader2 className={cn("w-4 h-4 text-blue-400", isProcessing && "animate-spin")} />
                      <span className="text-[11px] font-black text-white uppercase tracking-widest">
                        Tiến trình ({processingFiles.filter(f => f.status !== 'completed').length + pendingResults.length})
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                    {/* Files đang xử lý */}
                    {processingFiles.map((file) => (
                      <div
                        key={file.id}
                        onClick={() => file.status === 'completed' && file.result && setCurrentResult(file.result)}
                        className={cn(
                          "p-3 rounded-xl transition-all group relative",
                          file.status === 'completed' && file.result
                            ? currentResult?.id === file.result?.id
                              ? "bg-blue-600 cursor-pointer"
                              : "bg-blue-900/60 hover:bg-blue-900 cursor-pointer"
                            : "bg-blue-900/30 cursor-default"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                            file.status === 'completed' ? "bg-emerald-500/20 text-emerald-400" :
                            file.status === 'error' ? "bg-red-500/20 text-red-400" :
                            "bg-blue-800 text-blue-300"
                          )}>
                            {file.status === 'completed' ? <CheckCircle2 size={14} /> :
                             file.status === 'error' ? <AlertCircle size={14} /> :
                             file.status === 'processing' ? <Loader2 size={14} className="animate-spin" /> :
                             <FileText size={14} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate">{file.fileName}</p>
                            <p className={cn(
                              "text-[10px] font-medium mt-0.5",
                              file.status === 'completed' ? "text-emerald-400" :
                              file.status === 'error' ? "text-red-400" :
                              file.status === 'processing' ? "text-orange-400" : "text-blue-400"
                            )}>
                              {file.status === 'pending' ? 'Đang chờ...' :
                               file.status === 'processing' ? `Phân tích... ${file.progress}%` :
                               file.status === 'completed' ? 'Hoàn thành ✓' : 'Lỗi xử lý'}
                            </p>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeProcessingFile(file.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-blue-500 hover:text-red-400 transition-all"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {(file.status === 'processing' || file.status === 'pending') && (
                          <div className="mt-2 h-1 bg-blue-900 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 transition-all duration-500" style={{ width: `${file.progress}%` }} />
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Pending results chưa lưu */}
                    {pendingResults.map((result) => (
                      <div
                        key={result.id}
                        onClick={() => setCurrentResult(result)}
                        className={cn(
                          "p-3 rounded-xl cursor-pointer transition-all group relative",
                          currentResult?.id === result.id
                            ? "bg-orange-500"
                            : "bg-blue-900/60 hover:bg-blue-900"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-orange-500/20 text-orange-400 flex items-center justify-center flex-shrink-0">
                            <AlertCircle size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate">{result.pileId || result.fileName}</p>
                            <p className="text-[10px] text-orange-300 font-medium mt-0.5">Chờ kiểm duyệt</p>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); cancelResult(result.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-blue-500 hover:text-red-400 transition-all"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer cột trái */}
                  <div className="p-3 border-t border-blue-900/70 space-y-2">
                    {/* Nút Lưu tất cả - chỉ hiện khi có pending results */}
                    {pendingResults.length > 0 && processingFiles.every(f => f.status === 'completed' || f.status === 'error') && (
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Lưu tất cả ${pendingResults.length} kết quả?\n\nFile sẽ được upload GitHub và dữ liệu lưu Supabase.`)) return;
                          for (const r of [...pendingResults]) {
                            await saveResult(r);
                          }
                        }}
                        className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
                      >
                        <Save size={12} />
                        Lưu tất cả ({pendingResults.length})
                      </button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      <Upload size={12} />
                      Thêm file
                    </button>
                    {processingFiles.every(f => f.status === 'completed' || f.status === 'error') && processingFiles.length > 0 && pendingResults.length === 0 && (
                      <button
                        onClick={() => setProcessingFiles([])}
                        className="w-full py-2 text-slate-500 hover:text-red-400 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                      >
                        Xóa danh sách
                      </button>
                    )}
                  </div>
                </div>

                {/* CỘT PHẢI: Chi tiết + chỉnh sửa */}
                <div className="flex-1 bg-white overflow-y-auto">
                  {currentResult ? (
                    <div className="h-full flex flex-col">
                      {/* Header chi tiết */}
                      <div className="flex items-center justify-between bg-blue-600 px-8 py-5 flex-shrink-0">
                        <div className="flex items-center gap-4">
                          <div className="bg-white/10 p-2.5 rounded-xl">
                            <FileText size={20} className="text-white" />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white uppercase tracking-tight">
                              {currentResult.fileName || currentResult.pileId}
                            </h3>
                            <p className="text-[10px] text-blue-200 font-bold uppercase tracking-widest mt-0.5">
                              {pendingResults.some(r => r.id === currentResult.id) ? "Đang chờ kiểm duyệt — Xem và chỉnh sửa trước khi lưu" : "Dữ liệu đã lưu"}
                            </p>
                          </div>
                        </div>
                        {pendingResults.some(r => r.id === currentResult.id) && (
                          <div className="flex gap-3">
                            <button
                              onClick={() => { cancelResult(currentResult.id); setCurrentResult(null); }}
                              className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/10 flex items-center gap-2"
                            >
                              <X size={14} />
                              Hủy bỏ
                            </button>
                            <button
                              onClick={() => saveResult(currentResult)}
                              className="px-6 py-2.5 bg-white text-blue-700 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-50 transition-all shadow-lg flex items-center gap-2"
                            >
                              <Save size={14} />
                              Lưu dữ liệu
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Nội dung chi tiết = EditSplitView embedded */}
                      <div className="flex-1 overflow-hidden">
                        <EditSplitView
                          result={currentResult}
                          embedded={true}
                          onClose={() => setCurrentResult(null)}
                          onSave={(updated) => {
                            setCurrentResult(updated);
                            setPendingResults(prev => prev.map(r => r.id === updated.id ? updated : r));
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-12">
                      <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
                        <FileText size={32} className="text-slate-300" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-400 uppercase tracking-tight mb-2">Chọn file để xem chi tiết</h3>
                      <p className="text-sm text-slate-300 font-medium">Bấm vào một file bên trái để xem<br/>và chỉnh sửa dữ liệu trước khi lưu</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Khi không có file nào đang xử lý */
              <div className="w-full space-y-12">

            {/* Main Data Table on Sheet 1 */}
            {history.length > 0 && !currentResult && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[18px] font-black text-blue-900 tracking-tight flex items-center gap-3 uppercase">
                      <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
                      Dữ liệu thi công mới nhất
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
                  <button 
                    onClick={() => setActiveSheet('summary')}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-widest transition-colors"
                  >
                    Xem tất cả
                  </button>
                </div>
                
                <div className="modern-card overflow-hidden">
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="pro-table">
                      <thead>
                        <tr>
                          <th>Dự án</th>
                          <th>Hạng mục</th>
                          <th>Tên bộ phận</th>
                          <th>Số hiệu</th>
                          <th>Đường kính</th>
                          <th>Bắt đầu</th>
                          <th>Kết thúc</th>
                          <th>Tập tin</th>
                          <th className="text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="">
                        {history.slice(0, 10).map((item) => (
                          <tr key={item.id} className="hover:bg-sky-50/80 transition-colors group">
                            <td className="font-normal text-blue-900">{item.project}</td>
                            <td className="text-slate-900 font-normal">{item.item}</td>
                            <td className="text-slate-900 font-normal">{item.componentName}</td>
                            <td className="font-normal text-blue-900">{item.pileId}</td>
                            <td className="font-normal text-slate-900">{item.diameter}</td>
                            <td className="text-slate-900 font-normal">{item.constructionStart}</td>
                            <td className="text-slate-900 font-normal">{item.constructionEnd}</td>
                            <td>
                              {item.fileUrl ? (
                                <a 
                                  href={item.fileUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-bold text-[10px] uppercase tracking-widest transition-colors"
                                >
                                  <ExternalLink size={12} />
                                  Xem
                                </a>
                              ) : (
                                <span className="text-sky-200 text-[10px] font-bold uppercase tracking-widest italic">Chưa có</span>
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
            )}
          </div>
            )} {/* end else: không có file */}
          </div>
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
        <StatCard title="Đường kính" value={result.diameter} icon={<Activity className="text-blue-600" />} />
        <StatCard title="Tổng chiều sâu" value={`${result.layers.reduce((acc, l) => acc + l.lengthMeters, 0).toFixed(2)} m`} icon={<ArrowDownToLine className="text-orange-600" />} />
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
            TB: {(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length).toFixed(2)} m/h
          </div>
        </div>
      </div>

      <div className="modern-card overflow-hidden border border-slate-300 shadow-sm">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full border-collapse table-fixed min-w-[1500px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="sticky left-0 bg-slate-100 z-20 px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">Dự án</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">Hạng mục</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[150px]">Tên bộ phận</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Số hiệu</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Đường kính</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[140px]">Bắt đầu thi công</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[140px]">Kết thúc thi công</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[120px]">Địa chất thực tế</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[300px]">Lớp thiết kế</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Bắt đầu khoan</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Kết thúc khoan</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Thời gian</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Cao độ đầu</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Cao độ cuối</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider border-r border-slate-300 w-[100px]">Chiều dài</th>
                <th className="px-4 py-3 text-center text-[12px] font-black text-blue-900 uppercase tracking-wider w-[120px]">Tốc độ (m/h)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {result.layers.map((layer, idx) => (
                <tr key={idx} className="group hover:bg-slate-50 transition-colors">
                  <td className="sticky left-0 bg-white group-hover:bg-slate-50 z-10 font-normal text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.project}</td>
                  <td className="text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.item}</td>
                  <td className="text-black font-normal px-4 py-3 text-[11px] border-r border-slate-200">{layer.componentName}</td>
                  <td className="font-normal text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.pileId}</td>
                  <td className="text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.diameter}</td>
                  <td className="text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.constructionStart}</td>
                  <td className="text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.constructionEnd}</td>
                  <td className="text-blue-700 font-normal px-4 py-3 text-[11px] border-r border-slate-200">{layer.actualGeology}</td>
                  <td className="text-black italic text-[11px] leading-relaxed px-4 py-3 border-r border-slate-200 whitespace-normal">{layer.layerDesign}</td>
                  <td className="font-normal text-black px-4 py-3 text-[11px] border-r border-slate-200">
                    <div>{layer.timeFrom}</div>
                    {layer.dateFrom && <div className="text-[10px] text-slate-500">{layer.dateFrom}</div>}
                  </td>
                  <td className="font-normal text-black px-4 py-3 text-[11px] border-r border-slate-200">
                    <div>{layer.timeTo}</div>
                    {layer.dateTo && <div className="text-[10px] text-slate-500">{layer.dateTo}</div>}
                  </td>
                  <td className="text-center font-normal text-black bg-slate-50 px-4 py-3 text-[11px] border-r border-slate-200">{layer.durationHours.toFixed(2)}h</td>
                  <td className="text-center text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.elevationFrom}</td>
                  <td className="text-center text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.elevationTo}</td>
                  <td className="text-center font-normal text-black px-4 py-3 text-[11px] border-r border-slate-200">{layer.lengthMeters.toFixed(2)}m</td>
                  <td className="text-center px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-normal",
                      layer.speedMph > 5 ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"
                    )}>
                      {layer.speedMph.toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="modern-card p-10 md:col-span-2 bg-blue-900 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32" />
          <h4 className="text-sky-300 font-bold uppercase tracking-[0.3em] text-[10px] mb-6 flex items-center gap-2">
            <Activity size={14} />
            Phân tích năng suất địa chất
          </h4>
          <p className="text-white text-lg leading-relaxed font-medium italic relative z-10">
            "{result.summary}"
          </p>
        </div>
        <div className="modern-card p-10 flex flex-col justify-center items-center text-center">
          <h4 className="text-slate-900 font-bold uppercase tracking-widest text-[10px] mb-4">Tốc độ khoan trung bình</h4>
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-bold text-black tracking-tighter">
              {(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length).toFixed(2)}
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
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-[18px] font-black text-black tracking-tight flex items-center gap-3 uppercase">
            <div className="w-1.5 h-7 bg-orange-500 rounded-full" />
            Tổng hợp dữ liệu thi công
          </h3>
          <p className="text-xs text-slate-900 font-medium ml-4">Quản lý và theo dõi lịch sử trích xuất dữ liệu</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-white border border-slate-300 rounded-2xl px-5 py-2.5 shadow-sm">
            <p className="text-[9px] font-bold text-slate-900 uppercase tracking-widest mb-0.5">Tổng số cọc</p>
            <p className="text-xl font-bold text-black">{history.length}</p>
          </div>
          <div className="bg-white border border-slate-300 rounded-2xl px-5 py-2.5 shadow-sm">
            <p className="text-[9px] font-bold text-slate-900 uppercase tracking-widest mb-0.5">Tổng chiều sâu</p>
            <p className="text-xl font-bold text-black">
              {history.reduce((acc, res) => acc + res.layers.reduce((lAcc, l) => lAcc + l.lengthMeters, 0), 0).toFixed(1)} m
            </p>
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="modern-card p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
              <BarChart3 size={16} className="text-blue-600" />
              Biểu đồ tốc độ khoan trung bình (m/h)
            </h4>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history.slice().reverse().map(item => ({
                name: item.pileId,
                speed: parseFloat((item.layers.reduce((acc, l) => acc + l.speedMph, 0) / item.layers.length).toFixed(2))
              }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: 'none', 
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                />
                <Bar dataKey="speed" radius={[6, 6, 0, 0]}>
                  {history.slice().reverse().map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#2563eb' : '#f97316'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="bg-white border border-sky-200 border-dashed rounded-3xl py-32 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="bg-slate-50 p-6 rounded-full mb-6">
            <History className="text-slate-300 w-10 h-10" />
          </div>
          <h4 className="text-lg font-bold text-slate-400 uppercase tracking-widest">Chưa có dữ liệu lịch sử</h4>
          <p className="text-slate-400 mt-2 text-sm">Hãy bắt đầu bằng cách quét biên bản đầu tiên</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="modern-card overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="pro-table">
                <thead>
                  <tr>
                    <th>Dự án</th>
                    <th>Hạng mục</th>
                    <th>Tên bộ phận</th>
                    <th>Số hiệu</th>
                    <th>Đường kính</th>
                    <th>Chiều sâu (m)</th>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th>Tập tin</th>
                    <th className="text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="font-normal text-black">{item.project}</td>
                      <td className="text-black">{item.item}</td>
                      <td className="text-black">{item.componentName}</td>
                      <td className="font-normal text-black">{item.pileId}</td>
                      <td className="font-normal text-black">{item.diameter}</td>
                      <td className="font-normal text-orange-600">{item.layers.reduce((acc, l) => acc + l.lengthMeters, 0).toFixed(2)}</td>
                      <td className="text-black">{item.constructionStart}</td>
                      <td className="text-black">{item.constructionEnd}</td>
                      <td>
                        {item.fileUrl ? (
                          <a 
                            href={item.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-blue-700 hover:text-blue-900 font-bold text-[10px] uppercase tracking-widest transition-colors"
                          >
                            <ExternalLink size={12} />
                            Xem
                          </a>
                        ) : (
                          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest italic">Chưa có</span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-end gap-1.5">
                          <button 
                            onClick={() => onEdit(item)}
                            className="p-2 bg-slate-50 text-black rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-slate-300"
                            title="Chỉnh sửa"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => onDelete(item.id)}
                            className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-200"
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
  embedded = false
}: { 
  result: ExtractionResult; 
  onClose: () => void; 
  onSave: (res: ExtractionResult) => void;
  embedded?: boolean;
}) {
  const [data, setData] = useState<ExtractionResult>(result);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [displayUrl, setDisplayUrl] = useState<string | null>(result.fileUrl || null);
  const [isPdf, setIsPdf] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 0 });
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
      
      const elevStart = parseFloat(layer.elevationFrom.toString());
      const elevEnd = parseFloat(layer.elevationTo.toString());
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
            onClick={onClose}
            className="px-4 py-2 bg-white/10 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/20"
          >
            Hủy bỏ
          </button>
          <button 
            onClick={() => onSave(data)}
            className="px-6 py-2 bg-white text-blue-900 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all shadow-lg shadow-blue-950/20 flex items-center gap-2"
          >
            <Save size={14} />
            Lưu thay đổi
          </button>
        </div>
      </div>
      )} {/* end !embedded header */}

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
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Bắt đầu thi công</label>
              <input 
                value={data.constructionStart} 
                onChange={(e) => updateField('constructionStart', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[15px] font-black text-slate-900 uppercase tracking-widest">Kết thúc thi công</label>
              <input 
                value={data.constructionEnd} 
                onChange={(e) => updateField('constructionEnd', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all shadow-sm"
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
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'70px'}}>Địa chất</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Đường kính</th>
                      <th className="px-2 py-2 text-left text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300" style={{minWidth:'220px'}}>Lớp thiết kế</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Từ (h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Đến (h)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Cao độ từ</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>Cao độ đến</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'80px'}}>T.Gian</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'75px'}}>Dài (m)</th>
                      <th className="px-2 py-2 text-center text-[12px] font-black text-black uppercase tracking-wider border-r border-slate-300 whitespace-nowrap" style={{width:'75px'}}>V (m/h)</th>
                      
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
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`} style={{width:'70px'}}>
                          <input 
                            value={layer.actualGeology} 
                            onChange={(e) => updateLayer(idx, 'actualGeology', e.target.value)}
                            className={`w-full bg-transparent border-none text-[12px] text-blue-700 font-bold focus:bg-white px-2 py-1 text-center outline-none transition-all`}
                            placeholder="..."
                          />
                        </td>
                        <td className={`px-2 py-1 text-[12px] text-black text-center border-r border-slate-200 align-middle ${rowBg}`} style={{width:'80px'}}>
                          {data.diameter}
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle ${rowBg}`} style={{minWidth:'220px'}}>
                          <textarea 
                            value={layer.layerDesign}
                            onChange={(e) => {
                              updateLayer(idx, 'layerDesign', e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            rows={1}
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
                            value={layer.elevationFrom} 
                            onChange={(e) => updateLayer(idx, 'elevationFrom', e.target.value)}
                            className="bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-2 py-1 outline-none text-center transition-all"
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`p-0 border-r border-slate-200 align-middle whitespace-nowrap ${rowBg}`}>
                          <input 
                            type="text"
                            value={layer.elevationTo} 
                            onChange={(e) => updateLayer(idx, 'elevationTo', e.target.value)}
                            className="bg-transparent border-none text-[12px] text-black font-normal focus:bg-white px-2 py-1 outline-none text-center transition-all"
                            style={{ minWidth: '80px', width: '80px' }}
                          />
                        </td>
                        <td className={`px-2 py-1 text-[12px] font-normal text-black text-center ${rowBg} border-r border-slate-200 align-middle whitespace-nowrap`}>
                          {layer.durationHours.toFixed(2)}
                        </td>
                        <td className={`px-2 py-1 text-[12px] font-normal text-black text-center ${rowBg} border-r border-slate-200 align-middle whitespace-nowrap`}>
                          {layer.lengthMeters.toFixed(2)}
                        </td>
                        <td className="px-2 py-1 text-[12px] font-normal text-center bg-white align-middle border-r border-slate-200 whitespace-nowrap">
                          <span className={cn(
                            "inline-flex items-center px-1 py-0.5 rounded-full text-[12px] font-normal",
                            layer.speedMph > 5 ? "text-emerald-800 bg-emerald-100" : "text-orange-800 bg-orange-100"
                          )}>
                            {layer.speedMph.toFixed(2)}
                          </span>
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
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">STT</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Đường kính</th>
                      <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider border-r border-blue-700" style={{minWidth:'220px'}}>Lớp Thiết Kế</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Số đoạn</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Cao độ từ (m)</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Cao độ đến (m)</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Tổng T.Gian (h)</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider border-r border-blue-700 whitespace-nowrap">Tổng Dài (m)</th>
                      <th className="px-3 py-2 text-center text-[11px] font-black uppercase tracking-wider whitespace-nowrap">V TB (m/h)</th>
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
                            <td className={`px-3 py-2 text-[11px] font-bold text-center border-r border-slate-200 ${rowBg}`}>{i + 1}</td>
                            <td className={`px-3 py-2 text-[11px] text-black text-center border-r border-slate-200 ${rowBg}`}>{data.diameter}</td>
                            <td className={`px-3 py-2 text-[11px] font-medium border-r border-slate-200 ${rowBg} text-black`}>{g.layerDesign}</td>
                            <td className={`px-3 py-2 text-[11px] text-center border-r border-slate-200 ${rowBg}`}>{g.segments}</td>
                            <td className={`px-3 py-2 text-[11px] text-center border-r border-slate-200 ${rowBg}`}>{g.elevationFrom}</td>
                            <td className={`px-3 py-2 text-[11px] text-center border-r border-slate-200 ${rowBg}`}>{g.elevationTo}</td>
                            <td className={`px-3 py-2 text-[11px] text-center border-r border-slate-200 ${rowBg}`}>{g.totalDuration.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-[11px] text-center font-semibold border-r border-slate-200 ${rowBg}`}>{g.totalLength.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-[11px] text-center ${rowBg}`}>
                              <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold",
                                g.avgSpeed > 5 ? "text-emerald-800 bg-emerald-100" : "text-orange-800 bg-orange-100"
                              )}>
                                {g.avgSpeed.toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-400">
                      <td colSpan={3} className="px-3 py-2 text-[11px] font-black text-black uppercase border-r border-slate-300">Tổng cộng</td>
                      <td className="px-3 py-2 text-[11px] font-black text-center text-black border-r border-slate-300">
                        {data.layers.length}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-center border-r border-slate-300">
                        {data.layers.length > 0 ? data.layers[0].elevationFrom : '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-center border-r border-slate-300">
                        {data.layers.length > 0 ? data.layers[data.layers.length - 1].elevationTo : '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-black text-center text-black border-r border-slate-300">
                        {data.layers.reduce((s, l) => s + l.durationHours, 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-black text-center text-black border-r border-slate-300">
                        {data.layers.reduce((s, l) => s + l.lengthMeters, 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-[11px] font-black text-center text-black">
                        {(() => {
                          const totalLen = data.layers.reduce((s, l) => s + l.lengthMeters, 0);
                          const totalDur = data.layers.reduce((s, l) => s + l.durationHours, 0);
                          return totalDur > 0 ? (totalLen / totalDur).toFixed(2) : '—';
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Tóm tắt phân tích</label>
            <textarea 
              value={data.summary} 
              onChange={(e) => updateField('summary', e.target.value)}
              rows={4}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-black font-normal focus:border-blue-500 outline-none transition-all resize-none shadow-sm"
            />
          </div>
        </div>

        {/* Right: File Viewer */}
        {/* Right: File Viewer - 1/3 màn hình */}
        <div className="bg-slate-100 relative group flex flex-col shrink-0" style={{ width: '28%' }}>
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
