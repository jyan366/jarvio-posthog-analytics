#!/usr/bin/env python3
"""Data Pipeline Tests - Validates markdown parsing, data extraction, and transformation."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from parse_report_to_json import parse_markdown_report
from prepare_dashboard_data import transform_for_dashboard

REPORT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
                           'reports/posthog_report_2026-02-12.md')
CUSTOMER_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              'customer_data.json')


class TestMarkdownParsing(unittest.TestCase):
    """Test that the markdown report is parsed correctly."""
    
    @classmethod
    def setUpClass(cls):
        cls.data = parse_markdown_report(REPORT_PATH)
    
    def test_returns_dict(self):
        self.assertIsInstance(self.data, dict)
    
    def test_has_required_keys(self):
        for key in ['generated', 'dateRange', 'customers']:
            self.assertIn(key, self.data, f"Missing key: {key}")
    
    def test_date_range(self):
        self.assertEqual(self.data['dateRange']['start'], '2025-12-14')
        self.assertEqual(self.data['dateRange']['end'], '2026-02-12')
    
    def test_customer_count(self):
        # Report says 30 total customers; parsed ones have users
        self.assertGreater(len(self.data['customers']), 0)
        self.assertLessEqual(len(self.data['customers']), 30)
    
    def test_first_customer_is_theamazonwhisperer(self):
        self.assertEqual(self.data['customers'][0]['name'], 'theamazonwhisperer.com')


class TestUserDataExtraction(unittest.TestCase):
    """Test that user data is extracted accurately from the report."""
    
    @classmethod
    def setUpClass(cls):
        cls.data = parse_markdown_report(REPORT_PATH)
        cls.taw = cls.data['customers'][0]  # theamazonwhisperer.com
    
    def test_taw_active_users(self):
        self.assertEqual(self.taw['activeUsers'], 3)
    
    def test_taw_total_events(self):
        self.assertEqual(self.taw['totalEvents'], 71214)
    
    def test_taw_user_count(self):
        self.assertEqual(len(self.taw['users']), 3)
    
    def test_taw_user_emails(self):
        emails = [u['email'] for u in self.taw['users']]
        self.assertIn('alex@theamazonwhisperer.com', emails)
        self.assertIn('ben.w@theamazonwhisperer.com', emails)
        self.assertIn('ryan@theamazonwhisperer.com', emails)
    
    def test_taw_alex_events(self):
        alex = [u for u in self.taw['users'] if u['email'] == 'alex@theamazonwhisperer.com'][0]
        self.assertEqual(alex['events'], 14343)
    
    def test_taw_ryan_events(self):
        ryan = [u for u in self.taw['users'] if u['email'] == 'ryan@theamazonwhisperer.com'][0]
        self.assertEqual(ryan['events'], 56863)
    
    def test_taw_user_time_redistributed(self):
        """After redistribution of capped 240m values, times are proportional to events."""
        # Parser redistributes 240m-capped users proportionally by events
        # Total org time = avgSessionMinutes = 1681
        total = sum(u['totalTimeMinutes'] for u in self.taw['users'])
        self.assertEqual(total, 1681)
        # Ryan (56863 events) should have most time
        ryan = [u for u in self.taw['users'] if 'ryan' in u['email']][0]
        alex = [u for u in self.taw['users'] if 'alex' in u['email']][0]
        self.assertGreater(ryan['totalTimeMinutes'], alex['totalTimeMinutes'])
    
    def test_taw_flows(self):
        self.assertEqual(self.taw['flowsStarted'], 731)
        self.assertEqual(self.taw['flowsCompleted'], 240)
        self.assertEqual(self.taw['flowsFailed'], 3383)
    
    def test_taw_success_rate(self):
        self.assertAlmostEqual(self.taw['successRate'], 32.8, places=1)
    
    def test_taw_avg_session(self):
        self.assertEqual(self.taw['avgSessionMinutes'], 1681)


class TestTimeMetrics(unittest.TestCase):
    """Test time metric calculations."""
    
    @classmethod
    def setUpClass(cls):
        cls.data = parse_markdown_report(REPORT_PATH)
    
    def test_total_time_is_sum_of_users(self):
        for customer in self.data['customers']:
            expected = sum(u['totalTimeMinutes'] for u in customer['users'])
            self.assertEqual(customer['totalTimeMinutes'], expected,
                           f"{customer['name']}: totalTimeMinutes mismatch")
    
    def test_taw_total_time(self):
        taw = self.data['customers'][0]
        # After redistribution: total = avgSessionMinutes = 1681
        self.assertEqual(taw['totalTimeMinutes'], 1681)


class TestDailyData(unittest.TestCase):
    """Test daily activity data extraction."""
    
    @classmethod
    def setUpClass(cls):
        cls.data = parse_markdown_report(REPORT_PATH)
        cls.taw = cls.data['customers'][0]
    
    def test_taw_has_daily_data(self):
        self.assertGreater(len(self.taw['dailyData']), 0)
    
    def test_taw_daily_dates(self):
        dates = [d['date'] for d in self.taw['dailyData']]
        self.assertIn('2026-02-03', dates)
        self.assertIn('2026-02-04', dates)
    
    def test_taw_daily_event_values(self):
        daily = {d['date']: d['events'] for d in self.taw['dailyData']}
        self.assertEqual(daily['2026-02-03'], 1721)
        self.assertEqual(daily['2026-02-04'], 3609)
        self.assertEqual(daily['2026-02-05'], 3191)
        self.assertEqual(daily['2026-02-06'], 373)


class TestDashboardTransform(unittest.TestCase):
    """Test transformation to dashboard format."""
    
    @classmethod
    def setUpClass(cls):
        cls.parsed = parse_markdown_report(REPORT_PATH)
        cls.dashboard = transform_for_dashboard(cls.parsed)
    
    def test_has_organizations(self):
        self.assertIn('organizations', self.dashboard)
        self.assertGreater(len(self.dashboard['organizations']), 0)
    
    def test_has_date_range(self):
        self.assertIn('startDate', self.dashboard)
        self.assertIn('endDate', self.dashboard)
    
    def test_org_structure(self):
        org = self.dashboard['organizations'][0]
        self.assertIn('name', org)
        self.assertIn('users', org)
        self.assertEqual(org['name'], 'theamazonwhisperer.com')
    
    def test_user_structure(self):
        user = self.dashboard['organizations'][0]['users'][0]
        for key in ['email', 'totalTimeMinutes', 'events', 'flows', 'dailyData']:
            self.assertIn(key, user, f"Missing user key: {key}")
    
    def test_user_flows_structure(self):
        user = self.dashboard['organizations'][0]['users'][0]
        for key in ['started', 'completed', 'failed']:
            self.assertIn(key, user['flows'], f"Missing flows key: {key}")
    
    def test_org_count_matches(self):
        self.assertEqual(len(self.dashboard['organizations']), len(self.parsed['customers']))


class TestValidateAgainstKnownValues(unittest.TestCase):
    """Validate parsed data against known values from the report."""
    
    @classmethod
    def setUpClass(cls):
        cls.data = parse_markdown_report(REPORT_PATH)
        cls.customers = {c['name']: c for c in cls.data['customers']}
    
    def test_marketrocket_events(self):
        mr = self.customers.get('marketrocket.co.uk')
        self.assertIsNotNone(mr)
        self.assertEqual(mr['totalEvents'], 502)
    
    def test_marketrocket_active_users(self):
        mr = self.customers['marketrocket.co.uk']
        self.assertEqual(mr['activeUsers'], 2)
    
    def test_enflet_events(self):
        enf = self.customers.get('enflet.io')
        self.assertIsNotNone(enf)
        self.assertEqual(enf['totalEvents'], 469)
    
    def test_enflet_success_rate(self):
        enf = self.customers['enflet.io']
        self.assertAlmostEqual(enf['successRate'], 100.0, places=1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
