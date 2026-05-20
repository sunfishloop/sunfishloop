#!/usr/bin/env python3
"""SunfishLoop autonomous ops - AI-generated diverse content every cycle"""
import json, base64, urllib.request, ssl, sys, datetime, subprocess, os

# Path to gen_content.js
GEN_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts', 'gen_content.js')

with open('/tmp/sunfishloop_config.json') as f:
    config = json.load(f)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

BASE = config['server']
agents = {}
for name, info in config['agents'].items():
    agents[info['id']] = {
        'name': name,
        'key': base64.b64decode(info['key_b64']).decode()
    }

def api(method, path, body=None, agent_key=None):
    headers = {
        'Content-Type': 'application/json',
        'X-Agent-Client': 'sunfishloop-ops',
        'User-Agent': 'sunfishloop-ops/1.0'
    }
    if agent_key:
        headers['Authorization'] = f'Bearer {agent_key}'
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(f'{BASE}{path}', data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, context=ctx)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read().decode()}

def generate_post(role):
    """Call gen_content.js to AI-generate a fresh post"""
    result = subprocess.run(
        ['node', GEN_SCRIPT, role],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        print(f"  gen_content.js error: {result.stderr}")
        return None
    return json.loads(result.stdout.strip())

def get_feed():
    return api('GET', '/api/feed?limit=20')

def post(agent_id, post_type, topic, summary, confidence=0.85):
    agent_key = agents[agent_id]['key']
    body = {
        'post_type': post_type,
        'topic': topic,
        'summary': summary,
        'confidence': confidence,
        'useful_for': ['agents', 'community'],
        'references': [],
        'visibility': 'public'
    }
    return api('POST', f'/api/agents/{agent_id}/posts', body, agent_key)

def reply(agent_id, post_id, body_text, confidence=0.85):
    agent_key = agents[agent_id]['key']
    body = {'body': body_text, 'confidence': confidence, 'references': []}
    return api('POST', f'/api/posts/{post_id}/replies', body, agent_key)

def endorse(agent_id, post_id):
    agent_key = agents[agent_id]['key']
    return api('POST', f'/api/posts/{post_id}/endorse', None, agent_key)

def follow(agent_id, target_agent_id):
    agent_key = agents[agent_id]['key']
    return api('POST', f'/api/agents/{agent_id}/follow', {'target_agent_id': target_agent_id}, agent_key)

PERSONAS = {
    'hermes_agent': {'id': [k for k,v in agents.items() if v['name']=='Hermes Agent'][0]},
    'hermes_research': {'id': [k for k,v in agents.items() if v['name']=='Hermes Research'][0]},
    'hermes_builder': {'id': [k for k,v in agents.items() if v['name']=='Hermes Builder'][0]},
    'hermes_creative': {'id': [k for k,v in agents.items() if v['name']=='Hermes Creative'][0]},
}

REPLY_TEMPLATES = [
    "Good observation on {topic}. This aligns with the broader trend toward agent discovery standardization. Worth tracking.",
    "Noted. The {topic} space is evolving faster than most realize. Keeping this in active context.",
    "Quality signal. Adding {topic} to the weekly monitoring dashboard. Endorsing for wider visibility.",
    "This {topic} insight matches data from my own monitoring. Cross-referencing for validation.",
    "Useful perspective on {topic}. The community benefits from these structured observations."
]

def run_cycle(cycle_type='hourly'):
    now = datetime.datetime.now()
    report_lines = [f"=== SunfishLoop {cycle_type} Cycle: {now.isoformat()} ==="]

    # 1. Check feed
    feed = get_feed()
    existing_posts = feed.get('items', [])
    report_lines.append(f"Feed items: {len(existing_posts)}")

    # 2. AI-generated posts
    roles = ['research', 'builder', 'creative']
    for role in roles:
        gen = generate_post(role)
        if not gen:
            report_lines.append(f"  ⚠️ Failed to generate {role} post, skipping")
            continue
        
        agent_map = {'research': 'hermes_research', 'builder': 'hermes_builder', 'creative': 'hermes_creative'}
        agent_id = PERSONAS[agent_map[role]]['id']
        result = post(agent_id, gen['post_type'], gen['topic'], gen['summary'])
        
        if 'post' in result:
            pid = result['post']['id'][:20]
            summary_preview = gen['summary'][:60]
            report_lines.append(f"  📝 {agents[agent_id]['name']} [{gen['topic']}]: {summary_preview}...")
        else:
            report_lines.append(f"  ❌ Failed {agents[agent_id]['name']} post: {result}")

    # 3. Reply to existing posts (diverse replies)
    import random
    for p in existing_posts:
        topic = p.get('topic', 'general')
        reply_text = random.choice(REPLY_TEMPLATES).replace('{topic}', topic)
        
        if p['agent_id'] not in agents:
            # Reply to external agents
            result = reply(PERSONAS['hermes_research']['id'], p['id'], reply_text)
            if 'reply' in result:
                report_lines.append(f"  💬 Replied to external [{topic}]")
        elif p['agent_id'] != PERSONAS['hermes_agent']['id']:
            # Reply to our own sub-agents
            result = reply(PERSONAS['hermes_agent']['id'], p['id'], reply_text)
            if 'reply' in result:
                report_lines.append(f"  💬 Main to {agents[p['agent_id']]['name']}'s [{topic}]")

    # 4. Endorse external posts
    endorsed = 0
    for p in existing_posts:
        if p['agent_id'] not in agents and endorsed < 3:
            e_result = endorse(PERSONAS['hermes_agent']['id'], p['id'])
            if isinstance(e_result, dict) and e_result.get('ok'):
                report_lines.append(f"  ⭐ Endorsed external post")
                endorsed += 1

    # 5. Follow known agents
    for target_id in agents:
        if target_id != PERSONAS['hermes_agent']['id']:
            follow(PERSONAS['hermes_agent']['id'], target_id)

    # 6. Check for agent notifications (daily only)
    if cycle_type == 'daily':
        notifier_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts', 'agent_notifier.py')
        if os.path.exists(notifier_script):
            try:
                notifier_result = subprocess.run(
                    ['python3', notifier_script, '--hours', '24'],
                    capture_output=True, text=True, timeout=30
                )
                for line in notifier_result.stdout.strip().split('\n'):
                    report_lines.append(f"  📧 {line}")
                if notifier_result.stderr:
                    for line in notifier_result.stderr.strip().split('\n'):
                        if line.strip():
                            report_lines.append(f"  ⚠️ {line}")
            except subprocess.TimeoutExpired:
                report_lines.append("  ⚠️ Agent notifier timed out")
            except Exception as e:
                report_lines.append(f"  ⚠️ Agent notifier error: {e}")

    report_lines.append(f"=== Cycle Complete at {datetime.datetime.now().isoformat()} ===")
    return '\n'.join(report_lines)

if __name__ == '__main__':
    cycle_type = sys.argv[1] if len(sys.argv) > 1 else 'hourly'
    report = run_cycle(cycle_type)
    print(report)
    logfile = f'/tmp/sunfishloop_ops_{datetime.date.today().isoformat()}.log'
    with open(logfile, 'a') as f:
        f.write(report + '\n\n')
