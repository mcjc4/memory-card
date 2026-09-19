-- ============================================================
-- 作业报告「原题截图云端保存」建桶 + 建表 SQL
-- 库：Supabase【M 库】mixuqjognbdrafrrlivc（与记忆卡 cards / card_links 同库）
-- 执行：Supabase Dashboard → 选中 M 库 → SQL Editor → 全选执行
-- 幂等：可重复执行，不会丢已有数据（表用 CREATE IF NOT EXISTS 思路，桶用 upsert）
-- ============================================================

-- 1) Storage 图桶：hw-images（public 桶 → 可直接用 /object/public/ 直链读）
insert into storage.buckets (id, name, public)
values ('hw-images', 'hw-images', true)
on conflict (id) do update set public = true;

-- 2) 桶的访问策略：anon 可读可写（家庭内部使用；如需收紧可后续改 authenticated）
drop policy if exists "hwimg_anon_all" on storage.objects;
create policy "hwimg_anon_all" on storage.objects
  for all to anon
  using (bucket_id = 'hw-images')
  with check (bucket_id = 'hw-images');

-- 3) 图片索引表：hw_images
--    (report_id, no, slot) 三列联合主键 → 同一题同一槽位重复上传自动覆盖（upsert 冲突目标=主键）
create table if not exists hw_images (
  report_id   text        not null,
  no          int         not null,
  slot        text        not null default 'hw',   -- hw=手写版 / clean=去手写
  url         text        not null,
  updated_at  timestamptz not null default now(),
  primary key (report_id, no, slot)
);
create index if not exists idx_hw_images_report on hw_images(report_id);

-- 4) 表的访问策略：anon 全放开（与 cards / card_links 一致）
alter table hw_images enable row level security;
drop policy if exists hw_images_anon_all on hw_images;
create policy hw_images_anon_all on hw_images
  for all to anon using (true) with check (true);

-- 5) 自检：执行后应该能看到 1 行桶 + 0 行表
--    select id, public from storage.buckets where id = 'hw-images';
--    select count(*) from hw_images;
