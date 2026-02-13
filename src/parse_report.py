#!/usr/bin/env python3
"""
Parse the PostHog markdown report and convert to JSON format for dashboard_v2.html

FIX: The source report caps per-user session time at 240 minutes due to a bug in
posthog_usage_report.py (_get_user_details caps at 240m). The avg_session_time at
the org level is calculated differently (sum of all sub-240m sessions) and is more
accurate as a TOTAL time figure. When we detect that users are hitting the 240m cap,
we use the org-level avg_session_time as total org time and distribute proportionally
by event count.
"""

import re
import json
from datetime import datetime, timedelta


def parse_markdown_report(filepath):
    """Parse the markdown report and extract structured data"""
    with open(filepath, 'r') as f:
        content = f.read()

    customers = []

    # Split by customer sections (### header)
    sections = re.split(r'\n###\s+', content)

    for section in sections[1:]:  # Skip the header section
        lines = section.strip().split('\n')
        domain = lines[0].strip()

        customer_data = {
            'name': domain,
            'users': [],
            'totalTimeMinutes': 0,
            'totalEvents': 0,
            'flowsStarted': 0,
            'flowsCompleted': 0,
            'flowsFailed': 0,
            'dailyData': [],
            'avgSessionMinutes': 0,
            'activeUsers': 0,
        }

        in_users_section = False
        in_daily_section = False

        for line in lines[1:]:
            line = line.strip()

            if 'Active Users:' in line:
                match = re.search(r'\*\*(\d+)\*\*', line)
                if match:
                    customer_data['activeUsers'] = int(match.group(1))

            elif 'Total Events:' in line:
                match = re.search(r'\*\*([0-9,]+)\*\*', line)
                if match:
                    customer_data['totalEvents'] = int(match.group(1).replace(',', ''))

            elif 'Avg Session Time:' in line:
                match = re.search(r'~(\d+)\s+minutes', line)
                if match:
                    customer_data['avgSessionMinutes'] = int(match.group(1))

            elif '- Started:' in line:
                match = re.search(r'Started:\s*([0-9,]+)', line)
                if match:
                    customer_data['flowsStarted'] = int(match.group(1).replace(',', ''))
            elif '- Completed:' in line:
                match = re.search(r'Completed:\s*([0-9,]+)', line)
                if match:
                    customer_data['flowsCompleted'] = int(match.group(1).replace(',', ''))
            elif '- Failed:' in line:
                match = re.search(r'Failed:\s*([0-9,]+)', line)
                if match:
                    customer_data['flowsFailed'] = int(match.group(1).replace(',', ''))
            elif '- Success Rate:' in line:
                match = re.search(r'Success Rate:\s*([0-9.]+)%', line)
                if match:
                    customer_data['successRate'] = float(match.group(1))

            elif '**Daily Activity:**' in line:
                in_daily_section = True
                in_users_section = False
            elif in_daily_section and re.match(r'-\s*\d{4}-\d{2}-\d{2}:', line):
                match = re.search(r'-\s*(\d{4}-\d{2}-\d{2}):\s*([0-9,]+)\s+events', line)
                if match:
                    date_str = match.group(1)
                    events = int(match.group(2).replace(',', ''))
                    customer_data['dailyData'].append({
                        'date': date_str,
                        'events': events
                    })

            elif '**Users:**' in line:
                in_users_section = True
                in_daily_section = False
            elif in_users_section and line.startswith('-'):
                match = re.search(r'-\s*([^:]+):\s*([0-9,]+)\s+events?,\s*(\d+)m\s+time,\s*([0-9,]+)\s+flows?', line)
                if match:
                    email = match.group(1).strip()
                    events = int(match.group(2).replace(',', ''))
                    time_minutes = int(match.group(3))
                    flows = int(match.group(4).replace(',', ''))

                    customer_data['users'].append({
                        'email': email,
                        'events': events,
                        'totalTimeMinutes': time_minutes,
                        'flows': flows
                    })

            elif line.startswith('---'):
                break

        # --- FIX: Correct the 240m cap issue ---
        _fix_user_time(customer_data)

        if customer_data['users']:
            customers.append(customer_data)

    return {
        'generated': datetime.now().isoformat(),
        'dateRange': {
            'start': '2025-12-14',
            'end': '2026-02-12'
        },
        'customers': customers
    }


def _fix_user_time(customer_data):
    """
    The PostHog report generator caps individual user session time at 240 minutes.
    The org-level 'avg_session_time' is actually the TOTAL session time for the org
    (sum of all sessions < 240min). It's mislabeled as "avg" but is really total.
    
    Strategy:
    - If multiple users all show exactly 240m, they've been capped.
    - Use the org-level avgSessionMinutes as the total org time budget.
    - Distribute proportionally by each user's event count.
    - For users not capped (< 240m), keep their reported time.
    """
    users = customer_data['users']
    if not users:
        return

    avg_session = customer_data.get('avgSessionMinutes', 0)
    
    # Count how many active users hit the 240m cap
    capped_users = [u for u in users if u['totalTimeMinutes'] == 240 and u['events'] > 0]
    uncapped_users = [u for u in users if u['totalTimeMinutes'] != 240 or u['events'] == 0]
    
    if len(capped_users) <= 0:
        # No capping issue, just sum up
        customer_data['totalTimeMinutes'] = sum(u['totalTimeMinutes'] for u in users)
        return

    # The org-level "avg session time" from the report is actually the total
    # aggregated session time across all users (from _get_session_time which
    # sums all sessions < 240min). Use it as our total time budget.
    org_total_time = avg_session  # This is the real total, mislabeled as "avg"
    
    # Subtract time already accounted for by uncapped users
    uncapped_time = sum(u['totalTimeMinutes'] for u in uncapped_users)
    remaining_time = max(0, org_total_time - uncapped_time)
    
    # Distribute remaining time among capped users proportionally by events
    total_capped_events = sum(u['events'] for u in capped_users)
    
    if total_capped_events > 0:
        for u in capped_users:
            proportion = u['events'] / total_capped_events
            u['totalTimeMinutes'] = max(1, int(remaining_time * proportion))
    else:
        # Equal distribution if no events
        per_user = max(1, int(remaining_time / len(capped_users)))
        for u in capped_users:
            u['totalTimeMinutes'] = per_user

    # Recalculate total
    customer_data['totalTimeMinutes'] = sum(u['totalTimeMinutes'] for u in users)


if __name__ == '__main__':
    import sys
    report_path = sys.argv[1] if len(sys.argv) > 1 else 'data/sample_report.md'
    output_path = sys.argv[2] if len(sys.argv) > 2 else 'data/customer_data.json'

    print(f"Parsing {report_path}...")
    data = parse_markdown_report(report_path)

    print(f"Found {len(data['customers'])} customers")

    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Saved to {output_path}")

    # Print summary
    print("\nSummary:")
    for customer in data['customers']:
        total_time = customer['totalTimeMinutes']
        hours = total_time // 60
        minutes = total_time % 60
        print(f"  {customer['name']}: {hours}h {minutes}m, {len(customer['users'])} users, {customer['totalEvents']} events")
        for u in customer['users']:
            print(f"    {u['email']}: {u['totalTimeMinutes']}m, {u['events']} events")
