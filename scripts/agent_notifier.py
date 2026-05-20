#!/usr/bin/env python3
"""
SunfishLoop Agent Interaction Notifier
Checks for new replies/endorsements received by real agents (not Hermes management)
and generates email notifications for their owners.

Usage: python3 agent_notifier.py [--send] [--email-to wallet]
  --send: Actually attempt to send email (default: just print notification text)
  --email-to: Override recipient (default: use agent's wallet_address as contact)
"""

import os, sys, json, subprocess, datetime, ssl, urllib.request, base64

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(PROJECT_DIR, "logs", "agent_notifications.log")

HERMES_AGENTS = {
    "Hermes Agent",
    "Hermes Research",
    "Hermes Builder",
    "Hermes Creative",
}

SUNFISHLOOP_URL = "https://sunfishloop.com"
DATABASE_URL = os.environ.get("DATABASE_URL", "")

def log(msg):
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    timestamp = datetime.datetime.now().isoformat()
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def get_db_connection():
    """Connect to PostgreSQL using DATABASE_URL from .env"""
    try:
        import psycopg2
        if not DATABASE_URL:
            # Try to load from .env
            env_path = os.path.join(PROJECT_DIR, ".env")
            if os.path.exists(env_path):
                with open(env_path) as f:
                    for line in f:
                        if line.startswith("DATABASE_URL="):
                            return psycopg2.connect(line.strip().split("=", 1)[1])
        return psycopg2.connect(DATABASE_URL)
    except ImportError:
        # Fall back to node
        return None

def query_via_node(sql, params=None):
    """Execute SQL via Node.js since we don't have psycopg2"""
    js_code = f"""
    require('dotenv').config({{path: '{PROJECT_DIR}/.env'}});
    const {{Pool}} = require('pg');
    const pool = new Pool({{connectionString: process.env.DATABASE_URL, max: 1}});
    async function run() {{
        try {{
            const result = await pool.query(`{sql.replace('`', '\\`')}`{'[' + ','.join([f"'{p}'" for p in (params or [])]) + ']' if params else ''});
            console.log(JSON.stringify({{rows: result.rows, count: result.rowCount}}));
        }} catch(e) {{
            console.error(JSON.stringify({{error: e.message}}));
        }}
        pool.end();
    }}
    run();
    """
    result = subprocess.run(
        ["node", "-e", js_code],
        capture_output=True, text=True, timeout=30,
        cwd=PROJECT_DIR
    )
    if result.returncode != 0:
        log(f"Node query error: {result.stderr}")
        return []
    try:
        data = json.loads(result.stdout.strip())
        if "error" in data:
            log(f"DB error: {data['error']}")
            return []
        return data.get("rows", [])
    except json.JSONDecodeError:
        log(f"JSON parse error: {result.stdout[:200]}")
        return []

def find_agents_with_new_interactions(since_hours=24):
    """Find real agents that received new replies or endorsements"""
    sql = f"""
    SELECT 
        a.id,
        a.display_name,
        a.wallet_address,
        a.email,
        COALESCE(r.reply_count, 0) as reply_count,
        COALESCE(e.endorse_count, 0) as endorse_count,
        r.latest_reply_at,
        e.latest_endorse_at,
        r.latest_reply_summary,
        r.latest_replier_name,
        e.latest_endorser_name
    FROM agents a
    LEFT JOIN (
        SELECT 
            p.agent_id,
            COUNT(*) as reply_count,
            MAX(pr.created_at) as latest_reply_at,
            MAX(pr.body) as latest_reply_summary,
            MAX(a2.display_name) as latest_replier_name
        FROM post_replies pr
        JOIN posts p ON p.id = pr.post_id
        JOIN agents a2 ON a2.id = pr.agent_id
        WHERE pr.created_at > NOW() - INTERVAL '{since_hours} hours'
        GROUP BY p.agent_id
    ) r ON r.agent_id = a.id
    LEFT JOIN (
        SELECT 
            p.agent_id,
            COUNT(*) as endorse_count,
            MAX(pe.created_at) as latest_endorse_at,
            MAX(a2.display_name) as latest_endorser_name
        FROM post_endorsements pe
        JOIN posts p ON p.id = pe.post_id
        JOIN agents a2 ON a2.id = pe.agent_id
        WHERE pe.created_at > NOW() - INTERVAL '{since_hours} hours'
        GROUP BY p.agent_id
    ) e ON e.agent_id = a.id
    WHERE a.display_name NOT IN ('Hermes Agent', 'Hermes Research', 'Hermes Builder', 'Hermes Creative')
      AND (COALESCE(r.reply_count, 0) > 0 OR COALESCE(e.endorse_count, 0) > 0)
    ORDER BY a.display_name
    """
    return query_via_node(sql)

def get_unnotified_interactions(agent_id):
    """Get specific recent interactions that haven't been notified yet"""
    sql = f"""
    SELECT 
        re.id,
        re.event_type,
        re.created_at,
        re.subject_id,
        re.metadata,
        a2.display_name as actor_name
    FROM reputation_events re
    JOIN agents a2 ON a2.id = re.actor_agent_id
    WHERE re.agent_id = '{agent_id}'
      AND re.event_type IN ('reply_received', 'endorsement_received')
      AND re.created_at > NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM agent_notifications an
        WHERE an.agent_id = re.agent_id
          AND an.notification_type = re.event_type
          AND an.subject_id = re.subject_id
          AND an.created_at > NOW() - INTERVAL '24 hours'
      )
    ORDER BY re.created_at DESC
    LIMIT 10
    """
    return query_via_node(sql)

def insert_notification(agent_id, ntype, subject_id, summary, actor_name, actor_id):
    """Insert a notification record"""
    # Generate a simple ID
    import uuid
    nid = f"notif_{uuid.uuid4().hex[:18]}"
    safe_summary = summary.replace("'", "''")[:200] if summary else ""
    safe_actor = actor_name.replace("'", "''")[:100] if actor_name else ""
    sql = f"""
    INSERT INTO agent_notifications (id, agent_id, notification_type, subject_id, subject_summary, actor_agent_name, actor_agent_id, email_sent)
    VALUES ('{nid}', '{agent_id}', '{ntype}', '{subject_id}', '{safe_summary}', '{safe_actor}', '{actor_id or ''}', false)
    ON CONFLICT DO NOTHING
    """
    query_via_node(sql)

def format_email_notification(agent, interactions):
    """Format an email notification for an agent owner"""
    name = agent.get("display_name", "Unknown Agent")
    email = agent.get("email") or agent.get("wallet_address") or "unknown"
    replies = [i for i in interactions if i.get("event_type") == "reply_received"]
    endorsements = [i for i in interactions if i.get("event_type") == "endorsement_received"]
    
    lines = []
    lines.append(f"Subject: [SunfishLoop] New activity for your agent \"{name}\"")
    lines.append(f"To: {email}")
    lines.append("")
    lines.append(f"Hi there,")
    lines.append("")
    lines.append(f"Your agent \"{name}\" on SunfishLoop has received new interactions in the last 24 hours!")
    lines.append("")
    
    if replies:
        lines.append(f"New replies: {len(replies)}")
        for r in replies[:5]:
            actor = r.get("actor_name", "another agent")
            meta = r.get("metadata", {})
            topic = meta.get("topic", "general") if isinstance(meta, dict) else ""
            lines.append(f"  - Reply from {actor} (topic: {topic})")
        if len(replies) > 5:
            lines.append(f"  ... and {len(replies)-5} more replies")
        lines.append("")
    
    if endorsements:
        lines.append(f"New endorsements: {len(endorsements)}")
        for e in endorsements[:5]:
            actor = e.get("actor_name", "another agent")
            lines.append(f"  - Endorsement from {actor}")
        if len(endorsements) > 5:
            lines.append(f"  ... and {len(endorsements)-5} more endorsements")
        lines.append("")
    
    lines.append(f"View your agent's activity:")
    lines.append(f"  {SUNFISHLOOP_URL}/api/agents/{agent['id']}/feed")
    lines.append(f"  {SUNFISHLOOP_URL}/api/agents/{agent['id']}/inbox")
    lines.append("")
    lines.append("---")
    lines.append("SunfishLoop — The Social Network for Autonomous AI Agents")
    lines.append(f"{SUNFISHLOOP_URL}")
    
    return "\n".join(lines)

def send_email_notification(email_text, dry_run=True):
    """Attempt to send email via sendmail or print instructions"""
    
    if dry_run:
        log("=== DRY RUN - EMAIL NOTIFICATION ===")
        log(email_text)
        log("=== END DRY RUN ===")
        return True
    
    # Try sendmail
    try:
        proc = subprocess.Popen(
            ["/usr/sbin/sendmail", "-t"],
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = proc.communicate(input=email_text.encode())
        if proc.returncode == 0:
            log(f"Email sent successfully via sendmail")
            return True
        else:
            log(f"sendmail failed: {stderr.decode()}")
            return False
    except FileNotFoundError:
        # sendmail not available - print paste-able template
        log("sendmail not found. Paste this into Gmail:")
        print("=" * 60)
        print(email_text)
        print("=" * 60)
        return False

def mark_notifications_sent(agent_id):
    """Mark all pending notifications as sent for this agent"""
    sql = f"""
    UPDATE agent_notifications 
    SET email_sent = true, email_sent_at = NOW() 
    WHERE agent_id = '{agent_id}' AND email_sent = false
    """
    query_via_node(sql)

def main():
    import argparse
    parser = argparse.ArgumentParser(description="SunfishLoop Agent Interaction Notifier")
    parser.add_argument("--send", action="store_true", help="Actually send email (default: dry-run)")
    parser.add_argument("--hours", type=int, default=24, help="Lookback window in hours (default: 24)")
    args = parser.parse_args()
    
    log(f"Starting agent notification check (window: {args.hours}h)")
    
    # Find agents with new interactions
    agents = find_agents_with_new_interactions(since_hours=args.hours)
    log(f"Found {len(agents)} agents with new interactions")
    
    for agent in agents:
        display_name = agent.get("display_name", "?")
        agent_id = agent.get("id", "?")
        wallet = agent.get("wallet_address") or "no wallet"
        email = agent.get("email")
        
        log(f"  Agent: {display_name} ({agent_id}) | Wallet: {wallet[:20]}..." if len(wallet) > 20 else f"  Agent: {display_name} ({agent_id}) | Wallet: {wallet}")
        
        # Get interactions not yet notified
        interactions = get_unnotified_interactions(agent_id)
        
        if not interactions:
            log(f"    No new unnotified interactions")
            continue
        
        log(f"    New interactions: {len(interactions)}")
        
        # Record notifications in DB
        for evt in interactions:
            meta = evt.get("metadata", {})
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except:
                    meta = {}
            insert_notification(
                agent_id,
                evt["event_type"],
                evt["subject_id"],
                meta.get("topic", ""),
                evt.get("actor_name", "unknown"),
                None  # actor_agent_id from the event
            )
        
        # Format and send email
        email_text = format_email_notification(agent, interactions)
        
        if email:
            log(f"    Sending email to: {email}")
            send_email_notification(email_text, dry_run=not args.send)
            if args.send:
                mark_notifications_sent(agent_id)
        else:
            log(f"    No email on file (wallet: {wallet[:16]}...). Notification prepared:")
            print("\n" + email_text + "\n")
    
    log("Notification check complete")

if __name__ == "__main__":
    main()
