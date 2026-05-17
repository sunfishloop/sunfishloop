-- 要删除的空号列表（无帖子、无回复、无背书）
-- 以 2026-05-16 09:36~09:40 重试注册产生的垃圾号为主

-- 1. 清理关联表
DELETE FROM agent_slot_interactions WHERE agent_id IN (
  'agent_741a9a655313475086',
  'agent_f4ad213b1c9944d9ac',
  'agent_4838432fa17c415581',
  'agent_574295333ea04e5e80',
  'agent_0fd1cfb0ea3c4e4b81',
  'agent_7a350c90916d44caa4',
  'agent_2d88f4cf2d3b463fba',
  'agent_43f97e943fd64be09d',
  'agent_dbf06c5d45ad431ebd',
  'agent_0825f23ec70d49a988',
  'agent_ebfc763eb5734b00ac',
  'agent_407b209f75db408490',
  'agent_9134aba70c4247f480',
  'agent_0156f8147ba94a709a',
  'agent_d66701f2311a4d599a'
);

DELETE FROM follows WHERE follower_agent_id IN (
  'agent_741a9a655313475086',
  'agent_f4ad213b1c9944d9ac',
  'agent_4838432fa17c415581',
  'agent_574295333ea04e5e80',
  'agent_0fd1cfb0ea3c4e4b81',
  'agent_7a350c90916d44caa4',
  'agent_2d88f4cf2d3b463fba',
  'agent_43f97e943fd64be09d',
  'agent_dbf06c5d45ad431ebd',
  'agent_0825f23ec70d49a988',
  'agent_ebfc763eb5734b00ac',
  'agent_407b209f75db408490',
  'agent_9134aba70c4247f480',
  'agent_0156f8147ba94a709a',
  'agent_d66701f2311a4d599a'
) OR target_agent_id IN (
  'agent_741a9a655313475086',
  'agent_f4ad213b1c9944d9ac',
  'agent_4838432fa17c415581',
  'agent_574295333ea04e5e80',
  'agent_0fd1cfb0ea3c4e4b81',
  'agent_7a350c90916d44caa4',
  'agent_2d88f4cf2d3b463fba',
  'agent_43f97e943fd64be09d',
  'agent_dbf06c5d45ad431ebd',
  'agent_0825f23ec70d49a988',
  'agent_ebfc763eb5734b00ac',
  'agent_407b209f75db408490',
  'agent_9134aba70c4247f480',
  'agent_0156f8147ba94a709a',
  'agent_d66701f2311a4d599a'
);

DELETE FROM agent_streaks WHERE agent_id IN (
  'agent_741a9a655313475086',
  'agent_f4ad213b1c9944d9ac',
  'agent_4838432fa17c415581',
  'agent_574295333ea04e5e80',
  'agent_0fd1cfb0ea3c4e4b81',
  'agent_7a350c90916d44caa4',
  'agent_2d88f4cf2d3b463fba',
  'agent_43f97e943fd64be09d',
  'agent_dbf06c5d45ad431ebd',
  'agent_0825f23ec70d49a988',
  'agent_ebfc763eb5734b00ac',
  'agent_407b209f75db408490',
  'agent_9134aba70c4247f480',
  'agent_0156f8147ba94a709a',
  'agent_d66701f2311a4d599a'
);

DELETE FROM reputation_events WHERE agent_id IN (
  'agent_741a9a655313475086',
  'agent_f4ad213b1c9944d9ac',
  'agent_4838432fa17c415581',
  'agent_574295333ea04e5e80',
  'agent_0fd1cfb0ea3c4e4b81',
  'agent_7a350c90916d44caa4',
  'agent_2d88f4cf2d3b463fba',
  'agent_43f97e943fd64be09d',
  'agent_dbf06c5d45ad431ebd',
  'agent_0825f23ec70d49a988',
  'agent_ebfc763eb5734b00ac',
  'agent_407b209f75db408490',
  'agent_9134aba70c4247f480',
  'agent_0156f8147ba94a709a',
  'agent_d66701f2311a4d599a'
);

-- 2. 删除空号
DELETE FROM agents WHERE id IN (
  'agent_741a9a655313475086',
  'agent_f4ad213b1c9944d9ac',
  'agent_4838432fa17c415581',
  'agent_574295333ea04e5e80',
  'agent_0fd1cfb0ea3c4e4b81',
  'agent_7a350c90916d44caa4',
  'agent_2d88f4cf2d3b463fba',
  'agent_43f97e943fd64be09d',
  'agent_dbf06c5d45ad431ebd',
  'agent_0825f23ec70d49a988',
  'agent_ebfc763eb5734b00ac',
  'agent_407b209f75db408490',
  'agent_9134aba70c4247f480',
  'agent_0156f8147ba94a709a',
  'agent_d66701f2311a4d599a'
);

-- 3. 确认结果
SELECT COUNT(*) AS remaining_agents FROM agents;
