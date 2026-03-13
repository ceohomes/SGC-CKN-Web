# SGC - CKN | Construction Management

Hệ thống quản lý dữ liệu thi công cọc khoan nhồi.

## Tính năng mới (cập nhật)
- ✅ **Cột "File Dữ liệu"**: Tự động tạo file Excel và lưu link tải trực tiếp trên bảng danh sách
- ✅ Khi lưu biên bản → hệ thống tự export Excel → upload GitHub → lưu link vào Supabase
- ✅ Click link Excel trên bảng → tải về ngay lập tức

---

## Deploy lên Cloudflare Pages / Vercel / Netlify

### Bước 1: Cài đặt
```bash
npm install
```

### Bước 2: Build
```bash
npm run build
```
→ Kết quả nằm trong thư mục `dist/`

### Bước 3: Deploy
- **Cloudflare Pages**: Upload `dist/` hoặc kết nối GitHub repo (Build command: `npm run build`, Output: `dist`)
- **Vercel**: `vercel --prod`
- **Netlify**: Drag & drop thư mục `dist/`

---

## Cấu hình trong ứng dụng

Sau khi deploy, vào **Cài đặt** (⚙️) để nhập:
1. **Gemini API Key** — AI trích xuất dữ liệu
2. **GitHub Token + Username + Repo** — lưu file ảnh và Excel tự động
3. **Logo** — tuỳ chỉnh logo công ty

Node.js 18+ required.
