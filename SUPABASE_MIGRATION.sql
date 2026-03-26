-- ================================================================
-- MIGRATION: Tạo bảng app_pile_registry
-- Chạy script này trong Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS app_pile_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL,
  pile_code_raw       text NOT NULL,
  pile_code_canonical text NOT NULL,
  item          text DEFAULT '',
  created_at    timestamptz DEFAULT now(),
  created_by    text DEFAULT ''
);

-- Index để tìm kiếm nhanh theo dự án
CREATE INDEX IF NOT EXISTS idx_pile_registry_project ON app_pile_registry(project_id);
CREATE INDEX IF NOT EXISTS idx_pile_registry_canonical ON app_pile_registry(project_id, pile_code_canonical);

-- Enable Row Level Security (tuỳ chọn)
ALTER TABLE app_pile_registry ENABLE ROW LEVEL SECURITY;

-- Policy: cho phép đọc với tất cả authenticated users
CREATE POLICY "Allow read for authenticated" ON app_pile_registry
  FOR SELECT USING (auth.role() = 'authenticated');

-- Policy: chỉ admin mới được ghi (kiểm soát ở frontend, policy này là lớp bảo vệ thêm)
CREATE POLICY "Allow all for authenticated" ON app_pile_registry
  FOR ALL USING (auth.role() = 'authenticated');

-- ================================================================
-- HƯỚNG DẪN:
-- 1. Mở Supabase Dashboard > SQL Editor
-- 2. Dán toàn bộ script này vào và Run
-- 3. Bảng app_pile_registry sẽ được tạo tự động
-- ================================================================
