#!/usr/bin/env python3
"""
Convert customer_data.json to the format expected by dashboard_v2.html

FIX: Properly distribute per-user time across active days using daily event
proportions instead of leaving timeMinutes at 0.
"""

import json
from datetime import datetime


def transform_for_dashboard(customer_data):
    """Transform customer data to dashboard format"""
    organizations = []

    for customer in customer_data['customers']:
        users = []
        for user in customer['users']:
            daily_data = {}

            # Distribute user's total time across org's active days
            # proportionally by daily event counts
            if customer.get('dailyData') and user['totalTimeMinutes'] > 0:
                total_org_events = sum(d['events'] for d in customer['dailyData'])

                if total_org_events > 0:
                    # User's share of events per day
                    user_event_ratio = user['events'] / max(customer.get('totalEvents', 1), 1)

                    for day in customer['dailyData']:
                        if day['events'] > 0:
                            # What fraction of total org activity happened this day
                            day_fraction = day['events'] / total_org_events
                            # User's estimated time for this day
                            day_time = round(user['totalTimeMinutes'] * day_fraction, 1)
                            # User's estimated events for this day
                            day_events = int(day['events'] * user_event_ratio)

                            daily_data[day['date']] = {
                                'timeMinutes': day_time,
                                'events': day_events
                            }
                else:
                    # No event data - distribute evenly across days
                    num_days = len(customer['dailyData'])
                    per_day_time = round(user['totalTimeMinutes'] / num_days, 1)
                    for day in customer['dailyData']:
                        daily_data[day['date']] = {
                            'timeMinutes': per_day_time,
                            'events': 0
                        }

            user_obj = {
                'email': user['email'],
                'totalTimeMinutes': user['totalTimeMinutes'],
                'events': user['events'],
                'flows': {
                    'started': user.get('flows', 0),
                    'completed': 0,
                    'failed': 0
                },
                'dailyData': daily_data
            }
            users.append(user_obj)

        org_obj = {
            'name': customer['name'],
            'users': users
        }
        organizations.append(org_obj)

    return {
        'organizations': organizations,
        'startDate': customer_data['dateRange']['start'],
        'endDate': customer_data['dateRange']['end']
    }


def embed_in_dashboard(dashboard_path, dashboard_data):
    """Embed the data directly into dashboard.html by replacing the TIME_SERIES_DATA constant."""
    import re
    with open(dashboard_path, 'r') as f:
        html = f.read()

    data_js = 'const TIME_SERIES_DATA = ' + json.dumps(dashboard_data, indent=8) + ';'
    # Replace existing TIME_SERIES_DATA block
    updated = re.sub(
        r'const TIME_SERIES_DATA\s*=\s*\{.*?\};',
        data_js,
        html,
        flags=re.DOTALL
    )

    with open(dashboard_path, 'w') as f:
        f.write(updated)
    print(f"✅ Embedded data into {dashboard_path}")


def main():
    import sys
    json_path = sys.argv[1] if len(sys.argv) > 1 else 'data/customer_data.json'
    dashboard_path = sys.argv[2] if len(sys.argv) > 2 else 'dashboard.html'

    with open(json_path, 'r') as f:
        customer_data = json.load(f)

    dashboard_data = transform_for_dashboard(customer_data)

    # Embed directly into dashboard HTML
    embed_in_dashboard(dashboard_path, dashboard_data)

    print(f"   Organizations: {len(dashboard_data['organizations'])}")
    print(f"   Date range: {dashboard_data['startDate']} to {dashboard_data['endDate']}")

    print("\nTop 5 by time:")
    sorted_orgs = sorted(dashboard_data['organizations'],
                        key=lambda o: sum(u['totalTimeMinutes'] for u in o['users']),
                        reverse=True)

    for org in sorted_orgs[:5]:
        total_time = sum(u['totalTimeMinutes'] for u in org['users'])
        hours = total_time // 60
        minutes = total_time % 60
        user_count = len(org['users'])
        print(f"  {org['name']}: {hours}h {minutes}m ({user_count} users)")
        for u in org['users']:
            daily_times = [v['timeMinutes'] for v in u['dailyData'].values()]
            print(f"    {u['email']}: {u['totalTimeMinutes']}m total, daily: {daily_times[:5]}...")


if __name__ == '__main__':
    main()
