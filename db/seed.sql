-- ============================================================
-- xinghe-helper 示例数据脚本（seed.sql）
-- ============================================================
-- 前置条件：先执行过 db/schema.sql（四张表已存在）
--   · 如果报错 "relation ... does not exist"，就是还没跑建表脚本，先回去跑它。
-- 可重复执行：脚本开头先把四张表清空，再插入，跑几遍结果完全一样。
-- 数据来源：web/src/api/mockData.js（照抄，含 id），
--   目的是第 3 周前端从"假数据"切到"真接口"时，页面看起来一模一样，一眼能看出接对没接对。
-- ============================================================


-- ========== 1. 清空四张表，并把自增 ID 归零 ==========
-- truncate ... restart identity：清数据 + 自增编号从头开始
-- cascade：students 有外键指向 rooms/camps，需要连带清空，否则会被外键挡住
truncate table
  public.assignment_history,
  public.students,
  public.rooms,
  public.camps
restart identity cascade;


-- ========== 2. 营期（MVP 只有一个：id = 1）==========
insert into public.camps (id, name, org_name) values
  (1, '第一期口语拉练营', '示例机构');


-- ========== 3. 房间（4 间）==========
-- id 与 mockData 一致（101~104），方便后续前端联调时对得上
insert into public.rooms (id, camp_id, room_no, capacity, gender_label) values
  (101, 1, '301', 4, '女'),
  (102, 1, '302', 4, '男'),
  (103, 1, '303', 3, '女'),
  (104, 1, '304', 6, null);   -- gender_label 为空 = 尚未指定


-- ========== 4. 学生（12 人：9 人已分配 + 3 人未分配）==========
-- snore / sleep_quality / note 为空表示"没填"，与前端表单的"可选"一致
insert into public.students
  (id, camp_id, name, gender, teacher, class_level, check_in_date, room_pref,
   snore, sleep_quality, note, is_latest, superseded_by, assigned_room_id, assign_status)
values
  -- —— 已分配 9 人 ——
  (1,  1, '林小满', '女', 'Mona',   '星一', '2027-01-20', 4, false, '好',   null,               true, null, 101, '已分配'),
  (2,  1, '陈知夏', '女', 'Mona',   '星一', '2027-01-20', 4, true,  '一般', '轻度打呼,自己知道', true, null, 101, '已分配'),
  (3,  1, '王一诺', '女', 'Mona',   '星二', '2027-01-21', 4, false, '差',   null,               true, null, 101, '已分配'),
  (4,  1, '苏晚晴', '女', 'Selena', '星三', '2027-01-20', 3, false, '好',   null,               true, null, 103, '已分配'),
  (5,  1, '周砚',   '女', 'Selena', '星三', '2027-01-20', 3, false, '一般', null,               true, null, 103, '已分配'),
  (6,  1, '赵子昂', '男', 'Kiven',  '星一', '2027-01-20', 4, true,  '好',   null,               true, null, 102, '已分配'),
  (7,  1, '李昊然', '男', 'Kiven',  '星一', '2027-01-21', 4, false, '一般', null,               true, null, 102, '已分配'),
  (8,  1, '孙一飞', '男', 'Betty',  '星二', '2027-01-20', 6, false, '好',   '想和赵子昂一间',   true, null, 102, '已分配'),
  (9,  1, '何静姝', '女', 'Priya',  '星二', '2027-01-21', 2, false, '好',   null,               true, null, 103, '已分配'),
  -- —— 未分配 3 人（演示工作台左侧"未分配"区）——
  (10, 1, '郑楚',   '男', 'Betty',  '星三', '2027-01-20', 4, false, '好',   null,               true, null, null, '未分配'),
  (11, 1, '高远',   '男', 'Kiven',  '星二', '2027-01-21', 2, true,  '一般', null,               true, null, null, '未分配'),
  (12, 1, '沈知意', '女', 'Priya',  '星一', '2027-01-20', 3, false, '差',   '认床,怕吵',        true, null, null, '未分配');


-- ========== 5. 一条 AI 分房快照（供"恢复 AI 方案"按钮联调用）==========
-- 内容与上面 9 人的分配结果一致，第 3 周测试 2.12 接口时直接有数据可用
insert into public.assignment_history (camp_id, run_type, snapshot) values
  (1, 'ai', '{
    "rooms": { "301": [1, 2, 3], "302": [6, 7, 8], "303": [4, 5, 9] },
    "unassigned": [
      { "id": 10, "reason": "男生房间已满，需增加男生房间" },
      { "id": 11, "reason": "男生房间已满，需增加男生房间" },
      { "id": 12, "reason": "女生房间已满，需增加女生房间" }
    ]
  }'::jsonb);


-- ========== 6. 把自增编号推到正确位置 ==========
-- 上面是"指定 id"插入的，自增序列还停在起点；不校正的话，
-- 以后新增房间/学生会撞上已存在的 id 而报错。这一步就是修这个。
select setval('public.camps_id_seq',              (select max(id) from public.camps));
select setval('public.rooms_id_seq',              (select max(id) from public.rooms));
select setval('public.students_id_seq',           (select max(id) from public.students));
select setval('public.assignment_history_id_seq', (select max(id) from public.assignment_history));


-- ============================================================
-- 插入结果自查（可在下方直接复制执行）：
--   1) 四张表各有多少行
--        select 'camps' as 表名, count(*) from public.camps
--        union all select 'rooms', count(*) from public.rooms
--        union all select 'students', count(*) from public.students
--        union all select 'assignment_history', count(*) from public.assignment_history;
--      预期：camps=1, rooms=4, students=12, assignment_history=1
--
--   2) 每个房间住几人（房间卡片上的成员数）
--        select r.room_no, r.capacity, count(s.id) as 已住人数
--        from public.rooms r
--        left join public.students s
--          on s.assigned_room_id = r.id and s.is_latest = true
--        group by r.room_no, r.capacity
--        order by r.room_no;
--      预期：301→3/4, 302→3/4, 303→3/3, 304→0/6
--
--   3) 未分配名单（工作台左栏）
--        select id, name, gender, teacher, class_level
--        from public.students
--        where is_latest = true and assigned_room_id is null
--        order by id;
--      预期：3 行（郑楚、高远、沈知意）
-- ============================================================
