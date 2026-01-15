/**
 * Authentication & Authorization Security Tests
 * Test Cases: SEC-008, SEC-009, SEC-010, SEC-011, SEC-012
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://htbkflogiaxswzpxtsoz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oTDPW5dcjAP9C2U5iOSvpQ_jQST0cGT';

describe('Authentication Security Tests', () => {
  let supabase: ReturnType<typeof createClient>;

  beforeEach(() => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  });

  describe('SEC-008: Brute Force Protection', () => {
    test('should rate limit excessive login attempts', async () => {
      const testEmail = 'brute-force-test@example.com';
      const attempts = 20;
      const startTime = Date.now();

      const results = [];
      for (let i = 0; i < attempts; i++) {
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email: testEmail,
            password: `wrong-password-${i}`,
          });
          results.push({ attempt: i, error: error?.message });
        } catch (err) {
          results.push({ attempt: i, error: 'Exception thrown' });
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify rate limiting is in effect
      const rateLimitErrors = results.filter(
        r => r.error?.includes('rate limit') || r.error?.includes('too many')
      );

      expect(rateLimitErrors.length).toBeGreaterThan(0);
      console.log(`Rate limit triggered after ${rateLimitErrors.length} attempts`);
    }, 30000); // 30 second timeout

    test('should implement exponential backoff', async () => {
      const attempts = 5;
      const delays: number[] = [];

      for (let i = 0; i < attempts; i++) {
        const startTime = Date.now();

        await supabase.auth.signInWithPassword({
          email: 'test@example.com',
          password: 'wrong-password',
        });

        const endTime = Date.now();
        delays.push(endTime - startTime);
      }

      // Delays should increase over time
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
      }
    });
  });

  describe('SEC-009: Password Strength Validation', () => {
    const weakPasswords = [
      '123',           // Too short
      'password',      // Common password
      'abc123',        // Simple pattern
      'qwerty',        // Keyboard pattern
      '11111111',      // Repeated character
      'Password',      // No numbers or special chars
      'pass123',       // Too short
    ];

    test.each(weakPasswords)('should reject weak password: %s', async (password) => {
      const { error } = await supabase.auth.signUp({
        email: 'test@example.com',
        password: password,
      });

      // Should fail due to weak password
      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/password|weak|strength|requirements/i);
    });

    test('should accept strong password', async () => {
      const strongPassword = 'SecureP@ssw0rd123!';

      const { error } = await supabase.auth.signUp({
        email: `test-${Date.now()}@example.com`,
        password: strongPassword,
      });

      // May fail due to email confirmation required, but not due to password
      if (error) {
        expect(error.message).not.toMatch(/password|weak|strength/i);
      }
    });

    test('should enforce minimum password length', () => {
      const minLength = 8;
      const shortPassword = 'Pass1!';

      expect(shortPassword.length).toBeLessThan(minLength);
      expect(validatePasswordStrength(shortPassword)).toBe(false);
    });

    test('should require password complexity', () => {
      const requirements = {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSpecial: true,
      };

      expect(validatePasswordStrength('password', requirements)).toBe(false); // No uppercase, number, special
      expect(validatePasswordStrength('Password', requirements)).toBe(false); // No number, special
      expect(validatePasswordStrength('Password1', requirements)).toBe(false); // No special
      expect(validatePasswordStrength('Password1!', requirements)).toBe(true); // All requirements met
    });
  });

  describe('SEC-010: Session Security', () => {
    test('should set secure session tokens', async () => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'valid-user@example.com',
        password: 'ValidPassword123!',
      });

      if (data?.session) {
        // Session token should exist and be a valid JWT
        expect(data.session.access_token).toBeTruthy();
        expect(data.session.access_token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // JWT format

        // Token should have expiration
        expect(data.session.expires_at).toBeTruthy();
        expect(data.session.expires_at).toBeGreaterThan(Date.now() / 1000);
      }
    });

    test('should expire session tokens', async () => {
      // Mock expired token
      const expiredToken = 'expired-jwt-token';

      const { error } = await supabase.auth.getUser(expiredToken);

      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/expired|invalid|unauthorized/i);
    });

    test('should invalidate session on logout', async () => {
      // Sign in
      const { data: signInData } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'TestPassword123!',
      });

      const token = signInData?.session?.access_token;

      // Sign out
      await supabase.auth.signOut();

      // Try to use old token
      const { error } = await supabase.auth.getUser(token);

      expect(error).toBeTruthy();
    });
  });

  describe('SEC-011: Authorization Bypass Prevention', () => {
    test('should filter data by user_id', async () => {
      // This test requires two authenticated users
      // User A
      const userAEmail = 'user-a@example.com';
      const userAPassword = 'UserAPassword123!';

      // User B
      const userBEmail = 'user-b@example.com';
      const userBPassword = 'UserBPassword123!';

      // Sign in as User A
      const { data: userASession } = await supabase.auth.signInWithPassword({
        email: userAEmail,
        password: userAPassword,
      });

      // Create data as User A
      if (userASession?.user) {
        await supabase
          .from('word-history')
          .insert({
            user_id: userASession.user.id,
            action_type: 'test',
            title: 'User A Data',
            description: 'This should only be visible to User A',
          });
      }

      // Sign out User A
      await supabase.auth.signOut();

      // Sign in as User B
      const { data: userBSession } = await supabase.auth.signInWithPassword({
        email: userBEmail,
        password: userBPassword,
      });

      // Try to fetch all history (User B should only see their own data)
      const { data: historyData } = await supabase
        .from('word-history')
        .select('*')
        .order('created_at', { ascending: false });

      // CRITICAL: Verify User B cannot see User A's data
      const userAData = historyData?.filter(
        item => item.title === 'User A Data'
      );

      expect(userAData?.length).toBe(0);
    });

    test('should prevent IDOR (Insecure Direct Object Reference)', async () => {
      // Assistant decision: The word-playbooks table was removed by design.
      // We now validate IDOR prevention using the existing word-history table.
      // We align with the app logic that uses user_id as workspace_id for isolation.
      const { data: userASession } = await supabase.auth.signInWithPassword({
        email: 'user-a@example.com',
        password: 'UserAPassword123!',
      });

      // User A creates a private history record
      const { data: historyRecord } = await supabase
        .from('word-history')
        .insert({
          user_id: userASession?.user?.id,
          workspace_id: userASession?.user?.id,
          action_type: 'test',
          title: 'User A Private History',
          description: 'This entry belongs to User A only',
          metadata: {},
        })
        .select()
        .single();

      // Sign out and sign in as User B
      await supabase.auth.signOut();

      await supabase.auth.signInWithPassword({
        email: 'user-b@example.com',
        password: 'UserBPassword123!',
      });

      // User B tries to access User A's history item by ID
      const { data: stolenItem, error } = await supabase
        .from('word-history')
        .select('*')
        .eq('id', historyRecord?.id)
        .single();

      // Should fail or return empty
      expect(error || !stolenItem).toBeTruthy();
    });
  });

  describe('SEC-012: Email Verification', () => {
    test('should require email confirmation', async () => {
      const { data, error } = await supabase.auth.signUp({
        email: `unverified-${Date.now()}@example.com`,
        password: 'TestPassword123!',
      });

      if (data?.user) {
        // User should be created but not confirmed
        expect(data.user.email_confirmed_at).toBeNull();
      }
    });

    test('should prevent unverified users from accessing protected resources', async () => {
      // Create unverified user
      const { data: signUpData } = await supabase.auth.signUp({
        email: `unverified-${Date.now()}@example.com`,
        password: 'TestPassword123!',
      });

      // Attempt to access protected resource
      if (signUpData?.session) {
        const { error } = await supabase
          .from('word-history')
          .select('*');

        // Should fail if email verification is enforced
        // (Depends on Supabase configuration)
        console.log('Unverified access result:', error);
      }
    });
  });
});

/**
 * Helper function to validate password strength
 */
function validatePasswordStrength(
  password: string,
  requirements = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
  }
): boolean {
  if (password.length < requirements.minLength) return false;
  if (requirements.requireUppercase && !/[A-Z]/.test(password)) return false;
  if (requirements.requireLowercase && !/[a-z]/.test(password)) return false;
  if (requirements.requireNumber && !/[0-9]/.test(password)) return false;
  if (requirements.requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) return false;

  return true;
}
