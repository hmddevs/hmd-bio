"use client";

import { useState, FormEvent, Suspense } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import NextLink from "next/link";
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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update: updateSession } = useSession();
  const verified = searchParams.get("verified") === "1";
  const pending = searchParams.get("pending") === "1";
  const emailChange = searchParams.get("emailChange");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Resend verification state
  const [showResend, setShowResend] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendMsg, setResendMsg] = useState("");
  const [resendError, setResendError] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid credentials, account not yet verified, or pending approval");
      } else {
        // Fetch updated session to get user role for redirect
        const session = await updateSession();
        const role = session?.user?.role;
        router.push(role === "admin" ? "/admin" : "/dashboard");
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    setResendMsg("");
    setResendError(false);
    setResendLoading(true);
    try {
      const res = await fetch("/api/v1/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResendError(true);
        setResendMsg(data.error || "Something went wrong. Try again later.");
      } else {
        setResendMsg(data.data?.message || "If an unverified account exists with that email, a verification link has been sent.");
      }
    } catch {
      setResendError(true);
      setResendMsg("Network error. Please try again.");
    } finally {
      setResendLoading(false);
    }
  }

  return (
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
            Sign in to your account
          </Typography>
        </Box>

        {verified && !pending && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Email verified! You can now sign in.
          </Alert>
        )}

        {pending && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Email verified! Your account is pending admin approval. You&apos;ll receive an email once approved.
          </Alert>
        )}

        {emailChange === "success" && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Email address changed successfully. Please sign in with your new email.
          </Alert>
        )}
        {emailChange === "expired" && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Email change link has expired. Please request a new one.
          </Alert>
        )}
        {emailChange === "taken" && (
          <Alert severity="error" sx={{ mb: 2 }}>
            That email address is already in use by another account.
          </Alert>
        )}
        {emailChange === "invalid" && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Invalid email change link.
          </Alert>
        )}
        {emailChange === "error" && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Something went wrong. Please try again.
          </Alert>
        )}

        <Card>
          <CardContent sx={{ p: 3 }}>
            <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                label="Username or Email"
                required
                fullWidth
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
              <TextField
                label="Password"
                type="password"
                required
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {error && <Alert severity="error">{error}</Alert>}
              <Button
                type="submit"
                variant="contained"
                fullWidth
                size="large"
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign In"}
              </Button>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Don&apos;t have an account?{" "}
                <MuiLink component={NextLink} href="/signup">
                  Create one
                </MuiLink>
              </Typography>
            </Box>
          </CardContent>
        </Card>

        {/* Resend verification — separate from login form */}
        <Box sx={{ mt: 2, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            <MuiLink
              component="button"
              type="button"
              variant="body2"
              onClick={() => setShowResend((v) => !v)}
              sx={{ cursor: "pointer" }}
            >
              Didn&apos;t receive verification email?
            </MuiLink>
          </Typography>
          {showResend && (
            <Box
              component="form"
              onSubmit={handleResend}
              sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1.5, maxWidth: 400, mx: "auto" }}
            >
              <TextField
                label="Email address"
                type="email"
                required
                fullWidth
                size="small"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                autoComplete="email"
              />
              <Button
                type="submit"
                variant="outlined"
                size="small"
                disabled={resendLoading}
              >
                {resendLoading ? "Sending…" : "Resend Verification Email"}
              </Button>
              {resendMsg && (
                <Alert severity={resendError ? "error" : "success"} sx={{ fontSize: 13 }}>{resendMsg}</Alert>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default function UserLoginPage() {
  return (
    <MuiProvider>
      <Suspense>
        <LoginForm />
      </Suspense>
    </MuiProvider>
  );
}
