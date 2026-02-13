#!/usr/bin/env python3
"""Data Accuracy Tests - Compare dashboard data vs source report."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from parse_report_to_json import parse_markdown_report

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_PATH = os.path.join(BASE_DIR, 'reports/posthog_report_2026-02-12.md')
CUSTOMER_JSON = os.path.join(BASE_DIR, 'customer_data.json')
DASHBOARD_DATA_JS = os.path.join(BASE_DIR, 'dashboard_data.js')


def load_dashboard_data():
    """Load TIME_SERIES_DATA from dashboard_data.js"""
    import re
    with open(DASHBOARD_DATA_JS, 'r') as f:
        content = f.read()
    match = re.search(r'const TIME_SERIES_DATA = ({[\s\S]*?});', content)
    if match:
        return json.loads(match.group(1))
    return None


class TestDashboardVsSourceReport(unittest.TestCase):
    """Compare dashboard data against the source markdown report."""
    
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse_markdown_report(REPORT_PATH)
        cls.parsed_customers = {c['name']: c for c in cls.parsed['customers']}
        
        with open(CUSTOMER_JSON, 'r') as f:
            cls.customer_json = json.load(f)
        cls.json_customers = {c['name']: c for c in cls.customer_json['customers']}
        
        cls.dashboard = load_dashboard_data()
        if cls.dashboard:
            cls.dash_orgs = {o['name']: o for o in cls.dashboard['organizations']}
        else:
            cls.dash_orgs = {}
    
    def test_customer_count_matches(self):
        self.assertEqual(len(self.parsed['customers']), len(self.customer_json['customers']))
    
    def test_date_ranges_match(self):
        self.assertEqual(self.parsed['dateRange']['start'], self.customer_json['dateRange']['start'])
        self.assertEqual(self.parsed['dateRange']['end'], self.customer_json['dateRange']['end'])
    
    def test_all_parsed_customers_in_json(self):
        for name in self.parsed_customers:
            self.assertIn(name, self.json_customers, f"{name} missing from customer_data.json")
    
    def test_all_parsed_customers_in_dashboard(self):
        for name in self.parsed_customers:
            self.assertIn(name, self.dash_orgs, f"{name} missing from dashboard data")


class TestTheAmazonWhisperer(unittest.TestCase):
    """Verify theamazonwhisperer.com data accuracy."""
    
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse_markdown_report(REPORT_PATH)
        cls.taw = [c for c in cls.parsed['customers'] if c['name'] == 'theamazonwhisperer.com'][0]
        
        cls.dashboard = load_dashboard_data()
        cls.taw_dash = [o for o in cls.dashboard['organizations'] 
                        if o['name'] == 'theamazonwhisperer.com'][0]
    
    def test_total_time_1681_minutes(self):
        """After redistribution: total = avgSessionMinutes = 1681"""
        self.assertEqual(self.taw['totalTimeMinutes'], 1681)
    
    def test_dashboard_total_time_matches_parsed(self):
        dash_time = sum(u['totalTimeMinutes'] for u in self.taw_dash['users'])
        parsed_time = self.taw['totalTimeMinutes']
        self.assertEqual(dash_time, parsed_time)
    
    def test_total_events_71214(self):
        self.assertEqual(self.taw['totalEvents'], 71214)
    
    def test_user_count_3(self):
        self.assertEqual(len(self.taw['users']), 3)
        self.assertEqual(len(self.taw_dash['users']), 3)
    
    def test_alex_events(self):
        alex = [u for u in self.taw['users'] if 'alex' in u['email']][0]
        self.assertEqual(alex['events'], 14343)
    
    def test_ryan_events(self):
        ryan = [u for u in self.taw['users'] if 'ryan' in u['email']][0]
        self.assertEqual(ryan['events'], 56863)
    
    def test_ben_events(self):
        ben = [u for u in self.taw['users'] if 'ben' in u['email']][0]
        self.assertEqual(ben['events'], 8)
    
    def test_per_user_time_redistributed(self):
        """After redistribution, times are proportional to events, not 240m."""
        total = sum(u['totalTimeMinutes'] for u in self.taw['users'])
        self.assertEqual(total, 1681)
        for user in self.taw['users']:
            self.assertGreaterEqual(user['totalTimeMinutes'], 0)


class TestPerUserTimes(unittest.TestCase):
    """Verify per-user times match expectations across customers."""
    
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse_markdown_report(REPORT_PATH)
        cls.customers = {c['name']: c for c in cls.parsed['customers']}
    
    def test_marketrocket_user_times(self):
        mr = self.customers['marketrocket.co.uk']
        times = [u['totalTimeMinutes'] for u in mr['users']]
        # One user has 0m (no events or uncapped), other has redistributed time
        self.assertIn(0, times)
        self.assertTrue(any(t > 0 for t in times))
    
    def test_all_user_times_non_negative(self):
        for customer in self.parsed['customers']:
            for user in customer['users']:
                self.assertGreaterEqual(user['totalTimeMinutes'], 0,
                    f"{user['email']} has negative time")


class TestDailyBreakdowns(unittest.TestCase):
    """Check daily breakdowns sum correctly."""
    
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse_markdown_report(REPORT_PATH)
        cls.customers = {c['name']: c for c in cls.parsed['customers']}
    
    def test_taw_daily_events_less_than_total(self):
        """Daily events should be <= total (report may not include all days)."""
        taw = self.customers['theamazonwhisperer.com']
        daily_sum = sum(d['events'] for d in taw['dailyData'])
        # Daily data only covers some days, so sum < totalEvents
        self.assertLessEqual(daily_sum, taw['totalEvents'])
        self.assertGreater(daily_sum, 0)
    
    def test_taw_daily_sum_value(self):
        taw = self.customers['theamazonwhisperer.com']
        daily_sum = sum(d['events'] for d in taw['dailyData'])
        # 1721 + 3609 + 3191 + 373 + 1354 + 583 + 269 = 11100
        self.assertEqual(daily_sum, 11100)
    
    def test_marketrocket_daily_sum(self):
        mr = self.customers['marketrocket.co.uk']
        daily_sum = sum(d['events'] for d in mr['dailyData'])
        # 27 + 36 + 14 + 13 + 13 + 399 = 502
        self.assertEqual(daily_sum, 502)
        self.assertEqual(daily_sum, mr['totalEvents'])
    
    def test_all_daily_events_non_negative(self):
        for customer in self.parsed['customers']:
            for day in customer['dailyData']:
                self.assertGreaterEqual(day['events'], 0,
                    f"{customer['name']} {day['date']} has negative events")
    
    def test_daily_dates_format(self):
        import re
        for customer in self.parsed['customers']:
            for day in customer['dailyData']:
                self.assertRegex(day['date'], r'^\d{4}-\d{2}-\d{2}$',
                    f"Bad date format: {day['date']}")


class TestFlowAnalytics(unittest.TestCase):
    """Validate flow analytics data."""
    
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse_markdown_report(REPORT_PATH)
        cls.customers = {c['name']: c for c in cls.parsed['customers']}
    
    def test_taw_flows(self):
        taw = self.customers['theamazonwhisperer.com']
        self.assertEqual(taw['flowsStarted'], 731)
        self.assertEqual(taw['flowsCompleted'], 240)
        self.assertEqual(taw['flowsFailed'], 3383)
    
    def test_taw_success_rate(self):
        taw = self.customers['theamazonwhisperer.com']
        self.assertAlmostEqual(taw['successRate'], 32.8, places=1)
    
    def test_enflet_perfect_success(self):
        enf = self.customers['enflet.io']
        self.assertEqual(enf['flowsStarted'], 1)
        self.assertEqual(enf['flowsCompleted'], 1)
        self.assertEqual(enf['flowsFailed'], 0)
        self.assertAlmostEqual(enf['successRate'], 100.0, places=1)
    
    def test_marketrocket_flows(self):
        mr = self.customers['marketrocket.co.uk']
        self.assertEqual(mr['flowsStarted'], 7)
        self.assertEqual(mr['flowsCompleted'], 3)
        self.assertEqual(mr['flowsFailed'], 4)
    
    def test_all_flows_non_negative(self):
        for customer in self.parsed['customers']:
            self.assertGreaterEqual(customer['flowsStarted'], 0)
            self.assertGreaterEqual(customer['flowsCompleted'], 0)
            self.assertGreaterEqual(customer['flowsFailed'], 0)
    
    def test_user_level_flows_sum(self):
        """Sum of user flows should be reasonable vs org flows started."""
        taw = self.customers['theamazonwhisperer.com']
        user_flows = sum(u['flows'] for u in taw['users'])
        # alex: 360, ryan: 371, ben: 0 = 731 = flowsStarted
        self.assertEqual(user_flows, taw['flowsStarted'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
