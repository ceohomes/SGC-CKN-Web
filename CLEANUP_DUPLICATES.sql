-- ================================================================
-- BƯỚC 1: Xóa các dòng duplicate trong app_pile_registry
-- Giữ lại dòng có id nhỏ nhất (insert đầu tiên) cho mỗi cặp
-- (project_id, pile_code_canonical)
-- ================================================================

DELETE FROM app_pile_registry
WHERE id NOT IN (
  SELECT DISTINCT ON (project_id, pile_code_canonical) id
  FROM app_pile_registry
  ORDER BY project_id, pile_code_canonical, created_at ASC, id ASC
);

-- ================================================================
-- BƯỚC 2: Thêm UNIQUE constraint để tránh duplicate trong tương lai
-- ================================================================

ALTER TABLE app_pile_registry
  DROP CONSTRAINT IF EXISTS uq_pile_registry_project_canonical;

ALTER TABLE app_pile_registry
  ADD CONSTRAINT uq_pile_registry_project_canonical
  UNIQUE (project_id, pile_code_canonical);

-- ================================================================
-- KIỂM TRA: Xem số lượng cọc còn lại sau khi xóa
-- ================================================================
SELECT project_id, COUNT(*) as pile_count
FROM app_pile_registry
GROUP BY project_id
ORDER BY project_id;
