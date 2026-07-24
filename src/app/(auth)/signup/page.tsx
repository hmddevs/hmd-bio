"use client";

import { useState, useRef, useCallback, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import NextLink from "next/link";
import Script from "next/script";
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Link as MuiLink,
} from "@mui/material";
import MuiProvider from "@/components/providers/MuiProvider";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (el: HTMLElement | string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetRendered = useRef(false);

  const renderWidget = useCallback(() => {
    if (!SITE_KEY || !window.turnstile || !turnstileRef.current || widgetRendered.current) return;
    widgetRendered.current = true;
    window.turnstile.render(turnstileRef.current, {
      sitekey: SITE_KEY,
      theme: "auto",
      callback: (token: string) => setTurnstileToken(token),
    });
  }, []);

  useEffect(() => {
    if (window.turnstile) renderWidget();
  }, [renderWidget]);

  const resetTurnstile = useCallback(() => {
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.reset(turnstileRef.current);
    }
    setTurnstileToken("");
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username,
          password,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
      } else {
        setSuccess(data.data?.message || "Account created! Check your email.");
        setTimeout(() => router.push("/login"), 3000);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
      resetTurnstile();
    }
  }

  return (
    <>
      {SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
          onReady={renderWidget}
        />
      )}
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 400 }}>
        <Box sx={{ textAlign: "center", mb: 4 }}>
          <Typography variant="h4" fontWeight={700}>
            HMD<Box component="span" sx={{ color: "primary.main" }}>.bio</Box>
          </Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Create your account
          </Typography>
        </Box>

        <Card>
          <CardContent sx={{ p: 3 }}>
            <Box
              component="form"
              onSubmit={handleSubmit}
              sx={{ display: "flex", flexDirection: "column", gap: 2 }}
            >
              <TextField
                label="Email"
                type="email"
                required
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <TextField
                label="Username"
                required
                fullWidth
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                helperText="3–30 characters. Letters, numbers, hyphens, underscores."
              />
              <TextField
                label="Password"
                type="password"
                required
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                helperText="At least 8 characters."
              />
              {SITE_KEY && (
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <div ref={turnstileRef} />
                </Box>
              )}
              {error && <Alert severity="error">{error}</Alert>}
              {success && <Alert severity="success">{success}</Alert>}
              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={loading || !!success}
              >
                {loading ? "Creating account…" : "Create Account"}
              </Button>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Already have an account?{" "}
                <MuiLink component={NextLink} href="/login">
                  Sign in
                </MuiLink>
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="center">
                After email verification, an admin will review and approve your account.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
    </>
  );
}

export default function SignupPage() {
  return (
    <MuiProvider>
      <SignupForm />
    </MuiProvider>
  );
}
