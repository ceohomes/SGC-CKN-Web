# SGC-CKN v2.8 — Hướng dẫn Deploy lên Cloudflare Pages

## ✅ Thay đổi trong v2.8
- **Quản lý Dự án riêng biệt** (bảng `app_projects`) — tạo/đổi tên/xóa dự án không ảnh hưởng bảng biên bản
- **Phân quyền QS-QC**: tự động gán dự án khi upload biên bản (1 dự án → tự điền; nhiều dự án → AI so khớp)
- **Dropdown chọn Dự án** trong form chi tiết biên bản
- **Chuẩn hóa Data** chỉ Admin mới truy cập được

---

## 🗄️ Migration Supabase (BẮT BUỘC — chạy 1 lần)

Vào **Supabase Dashboard → SQL Editor** và chạy lệnh sau:

```sql
-- Tạo bảng quản lý dự án
CREATE TABLE IF NOT EXISTS public.app_projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  TEXT DEFAULT ''
);

-- Bật RLS (Row Level Security) nếu cần
ALTER TABLE public.app_projects ENABLE ROW LEVEL SECURITY;

-- Cho phép tất cả operations (điều chỉnh theo yêu cầu bảo mật)
CREATE POLICY "allow_all" ON public.app_projects FOR ALL USING (true) WITH CHECK (true);
```

---

## 🚀 Deploy lên Cloudflare Pages

### 1. Push code lên GitHub
```bash
git init && git add . && git commit -m "SGC-CKN v2.7"
git remote add origin https://github.com/YOUR_USERNAME/sgc-ckn.git
git push -u origin main
```

### 2. Tạo project Cloudflare Pages
- Vào dash.cloudflare.com → Workers & Pages → Create → Pages → Connect Git
- Build command: `npm run build` | Output: `dist` | Node: `20`

### 3. Environment Variables (Settings → Environment variables)
| Variable | Mô tả |
|----------|-------|
| `VITE_SUPABASE_URL` | URL Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Anon key Supabase |
| `GITHUB_TOKEN` | GitHub Personal Access Token (quyền repo) |
| `GITHUB_USERNAME` | GitHub username |
| `GITHUB_REPO` | Tên repo lưu file (VD: construction-reports) |
| `GEMINI_API_KEY` | API Key Gemini (tùy chọn) |

### 4. Thêm cột Supabase (chạy 1 lần)
```sql
ALTER TABLE drill_extractions 
ADD COLUMN IF NOT EXISTS "casingElevation" NUMERIC DEFAULT NULL;
```

---

## Chạy local
```bash
npm install
npm run dev
```
