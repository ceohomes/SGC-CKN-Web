# SGC-CKN v2.7 — Hướng dẫn Deploy lên Cloudflare Pages

## ✅ Thay đổi trong v2.7
- **Nhập cao độ đỉnh casing** → hệ thống tự tính Cao độ từ/đến tuyệt đối cho từng lớp địa chất
- AI đọc "Cao độ đỉnh casing" từ header biên bản (cả Loại A và Loại B)
- Nút **"Tính lại cao độ"** trong màn hình chỉnh sửa
- Preview nhanh cao độ 5 lớp đầu trước khi áp dụng

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
