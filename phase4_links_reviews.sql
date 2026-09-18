-- ============================================================================
-- Phase 4：card_links（互链）+ card_reviews（重练标注·仅陈昕言）建表
-- 库：Supabase【M 库】mixuqjognbdrafrrlivc（与记忆卡 cards 表同库）
-- 执行：Supabase Dashboard → 选中 M 库 → SQL Editor 全选执行
--       （AI 沙箱连不上 supabase.co，无法代跑，沿用历史所有建表 SQL 的既定流程）
-- 幂等：重复执行安全；card_links / card_reviews 用 DROP+CREATE 重建（新功能、无历史数据）。
-- ============================================================================

-- 1) 互链表（junction，支持双向反查）
--    target_kind ∈ {wrong_question, courseware, knowledge_node, card}
DROP TABLE IF EXISTS card_links;
CREATE TABLE card_links (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id      text NOT NULL,
  target_kind  text NOT NULL,
  target_id    text NOT NULL,
  relation     text DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_card_links_card    ON card_links(card_id);
CREATE INDEX IF NOT EXISTS idx_card_links_target  ON card_links(target_kind, target_id);

-- 2) 重练状态表（仅陈昕言一人，无 executor 维度）
--    level 沿用编码：1/0=记住  3=模糊  2=没记住；needs_repractice=true 即"待重练"
DROP TABLE IF EXISTS card_reviews;
CREATE TABLE card_reviews (
  card_id           text NOT NULL PRIMARY KEY,
  level             smallint DEFAULT 0,
  last_result       smallint DEFAULT 0,
  review_count      int DEFAULT 0,
  needs_repractice  boolean DEFAULT false,
  reason            text DEFAULT '',
  next_due_at       timestamptz,
  last_reviewed_at  timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 3) cards 加入 Realtime 发布（增量推送，省 egress，配合前端 delta 轮询兜底）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='cards') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cards;
  END IF;
END $$;
ALTER TABLE cards REPLICA IDENTITY FULL;

-- 4) RLS：anon 全放开（与 cards / cards_pending / mistakes 一致；publishable key 已公开于前端）
ALTER TABLE card_links    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS card_links_anon_all ON card_links;
CREATE POLICY card_links_anon_all ON card_links FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE card_reviews  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS card_reviews_anon_all ON card_reviews;
CREATE POLICY card_reviews_anon_all ON card_reviews FOR ALL TO anon USING (true) WITH CHECK (true);

-- 验证
-- SELECT count(*) FROM card_links;
-- SELECT card_id, needs_repractice, reason FROM card_reviews WHERE needs_repractice = true;
