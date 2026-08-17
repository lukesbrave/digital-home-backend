'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      window.location.href = '/content';
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-minimal-bg">
      <form onSubmit={handleLogin} className="w-full max-w-[360px] px-10">
        {/* Logo */}
        <div className="mb-16">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white mb-6" viewBox="0 0 256 256" fill="currentColor">
            <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z" />
          </svg>
          <h1 className="text-base font-semibold text-white">Digital Home</h1>
        </div>

        {/* Email */}
        <div className="mb-6">
          <label htmlFor="email" className="block text-[13px] font-medium text-zinc-300 mb-2">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-minimal-row border border-minimal-border rounded-lg px-3 py-2.5 text-[14px] text-white focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>

        {/* Password */}
        <div className="mb-8">
          <label htmlFor="password" className="block text-[13px] font-medium text-zinc-300 mb-2">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-minimal-row border border-minimal-border rounded-lg px-3 py-2.5 text-[14px] text-white focus:outline-none focus:border-zinc-500 transition-colors"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-[13px] mb-4">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-white text-black text-[14px] font-semibold rounded-lg disabled:opacity-30 transition-opacity"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

      </form>
    </div>
  );
}
