-- ============================================================
-- 写接口权限开通 SQL（Day 18 · POST /api/rooms 部署时发现）
-- ============================================================
-- 【什么时候跑这个】
--   Day 18 部署 POST /api/rooms 后，首次写入报：
--     {"ok":false,"error":{"code":"DB_ERROR",
--      "message":"新建房间失败:permission denied for table rooms"}}
--   读接口正常、写接口被拒 —— 说明表上有 SELECT、缺 INSERT。
--   这就是契约第 1 节预留的那句「写接口若报权限错误，再按需补 GRANT（届时处理）」。
--
-- 【为什么需要】
--   云函数用 app.rdb() 走平台网关访问数据库时，用的是 anon（匿名访客）身份。
--   Day 16 建表时只给了 anon 读权限（SELECT），够Day 17 的两个读接口用；
--   但写接口需要 INSERT/UPDATE/DELETE，所以要补上。
--
-- 【怎么跑】
--   控制台 → 云开发 → 数据库 → SQL 编辑器 → 全选下面这段 → 执行
--   （注意：先确认左上角数据库是 postgres-fnv0lCw，schema 是 public）
--
-- 【安全提醒 · 请先读完再跑】
--   anon 是「任何人拿到链接都能用」的身份。这里给 anon 写权限，意味着
--   任何人都能通过这个接口往rooms 表加房间。
--   对当前阶段（内部工具、体验版、数据是示例数据）是可接受的 ——
--   契约第 4 节已说明本项目用的是体验版共享集群，没有更细的鉴权机制可用。
--   ⚠️ 但如果以后这套东西要给真实学生数据用，必须先加登录态校验
--      （校验 token / 限定管理员身份），再开放写权限。
--      到那时记得回来把这段 GRANT 收回去。
-- ============================================================


-- ---------- 1. 先看清现状：anon 现在到底有哪些权限 ----------
-- 预期能看到 rooms 的权限是 `SELECT`（只有读，没有写）
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;


-- ---------- 2. 补上写权限（本段是要执行的） ----------
-- 说明每条为什么需要：
--   INSERT    —— 新建房间（契约 2.6）、批量分配（2.10）、存快照（2.11）
--   UPDATE    —— 改房间（2.7）、单个分配（2.9）、插入后回填id（2.6 的 .select('id')）
--   DELETE    —— 删房间（2.8）
-- 今天只用到 rooms 表；等做到 2.3 POST /api/students 时再开 students，
-- 不提前开 —— 少开一份权限就少一份风险。
grant insert, update, delete on table public.rooms to anon;

-- PostgREST 要能拿到新增行的 id，需要在 RETURNING 阶段读该行。
-- 严格说 SELECT 已由 Day 16 开过，这里再显式确认一次，避免依赖推断。
grant select on table public.rooms to anon;


-- ---------- 3. 跑完验证：应该能看到 rooms 现在有 4 种权限 ----------
select privilege_type, count(*)
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name = 'rooms'
group by privilege_type
order by privilege_type;
-- 预期输出：DELETE / INSERT / SELECT / UPDATE 各 1


-- ============================================================
-- 跑完怎么验接口通了？（三条命令，见api-contract.md 契约 2.6）
--
--   ① 正常：curl -X POST .../api/rooms -H "Content-Type: application/json" \
--            -d '{"camp_id":1,"room_no":"305","capacity":4}'
--      期望：{"ok":true,"data":{"id":105},"error":null}
--
--   ② 重复：同上但 room_no 改成 305 再跑一次（capacity 改成 6）
--      期望：HTTP 409，code = ROOM_NO_DUPLICATED，
--            且数据库里305 的 capacity 仍是 4（证明没被覆盖）
--
--   ③ 缺字段：-d '{"room_no":"306","capacity":4}'（不传 camp_id）
--      期望：HTTP 400，code = VALIDATION_ERROR，
--            message =缺少必填字段 camp_id(所属营期)
--
--   数据库核对：
--     select id, camp_id, room_no, capacity from public.rooms order by id;
--     305 应只有一行、capacity = 4
--
--   最后读回确认（证明新数据能被 GET 读出来）：
--     curl ".../api/rooms?camp_id=1"
--     返回的 data 数组里应能看到 305，且按 room_no 升序
-- ============================================================