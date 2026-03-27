-- ================================================================
-- MIGRATION: Tạo bảng app_pile_registry
-- Chạy script này trong Supabase SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS app_pile_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL,
  stt           text DEFAULT '',
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

-- Policy: cho phép đọc với tất cả (bao gồm anon)
DROP POLICY IF EXISTS "Allow read for authenticated" ON app_pile_registry;
CREATE POLICY "Allow read for all" ON app_pile_registry
  FOR SELECT USING (true);

-- Policy: cho phép ghi với tất cả (bao gồm anon) để sửa lỗi RLS
DROP POLICY IF EXISTS "Allow all for authenticated" ON app_pile_registry;
CREATE POLICY "Allow all for all" ON app_pile_registry
  FOR ALL USING (true) WITH CHECK (true);

-- ================================================================
-- SỬA LỖI RLS CHO CÁC BẢNG KHÁC
-- ================================================================

-- app_users
ALTER TABLE IF EXISTS app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for all" ON app_users;
CREATE POLICY "Allow all for all" ON app_users FOR ALL USING (true) WITH CHECK (true);

-- app_settings
ALTER TABLE IF EXISTS app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for all" ON app_settings;
CREATE POLICY "Allow all for all" ON app_settings FOR ALL USING (true) WITH CHECK (true);

-- app_projects
ALTER TABLE IF EXISTS app_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for all" ON app_projects;
CREATE POLICY "Allow all for all" ON app_projects FOR ALL USING (true) WITH CHECK (true);

-- app_items
ALTER TABLE IF EXISTS app_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for all" ON app_items;
CREATE POLICY "Allow all for all" ON app_items FOR ALL USING (true) WITH CHECK (true);

-- app_drilling_machines
ALTER TABLE IF EXISTS app_drilling_machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for all" ON app_drilling_machines;
CREATE POLICY "Allow all for all" ON app_drilling_machines FOR ALL USING (true) WITH CHECK (true);

-- drill_extractions
ALTER TABLE IF EXISTS drill_extractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for all" ON drill_extractions;
CREATE POLICY "Allow all for all" ON drill_extractions FOR ALL USING (true) WITH CHECK (true);

-- ================================================================
-- HƯỚNG DẪN:
-- 1. Mở Supabase Dashboard > SQL Editor
-- 2. Dán toàn bộ script này vào và Run
-- 3. Bảng app_pile_registry sẽ được tạo tự động
-- ================================================================
