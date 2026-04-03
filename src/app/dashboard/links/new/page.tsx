"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  CircularProgress,
  Alert,
} from "@mui/material";

export default function CreateLinkPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(null);

    try {
      const res = await fetch("/api/v1/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          ...(keyword && { keyword }),
          ...(title && { title }),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to create link");
        return;
      }
      setSuccess(json.data.shortUrl);
      setUrl("");
      setKeyword("");
      setTitle("");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Create Link
      </Typography>

      <Card sx={{ maxWidth: 600 }}>
        <CardContent>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && (
              <Alert severity="success">
                Link created:{" "}
                <strong
                  style={{ cursor: "pointer" }}
                  onClick={() => navigator.clipboard.writeText(success)}
                >
                  {success}
                </strong>{" "}
                (click to copy)
              </Alert>
            )}

            <TextField
              label="Destination URL"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Custom keyword (optional)"
              placeholder="my-link"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              fullWidth
              helperText="Leave empty for a random keyword"
            />
            <TextField
              label="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />

            <Box sx={{ display: "flex", gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                disabled={loading || !url}
                sx={{ minWidth: 120 }}
              >
                {loading ? <CircularProgress size={20} /> : "Create"}
              </Button>
              <Button variant="outlined" onClick={() => router.push("/dashboard/links")}>
                My Links
              </Button>
            </Box>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
