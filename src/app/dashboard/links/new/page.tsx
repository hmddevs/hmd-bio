"use client";

import { useState, useEffect } from "react";
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
  Select,
  MenuItem,
  InputLabel,
  FormControl,
} from "@mui/material";
import { captureError } from "@/lib/errors";

const PRIMARY_DOMAIN = process.env.NEXT_PUBLIC_PRIMARY_DOMAIN?.trim().toLowerCase() || "hmd.bio";

export default function CreateLinkPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState(PRIMARY_DOMAIN);
  const [activeDomains, setActiveDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function loadDomains() {
      try {
        const res = await fetch("/api/v1/domains");
        const json = await res.json();
        if (json.success) {
          const active = (json.data.domains as { hostname: string; status: string }[])
            .filter((d) => d.status === "active")
            .map((d) => d.hostname);
          setActiveDomains(active);
        }
      } catch (err) {
        captureError(err, { route: "dashboard/links/new", action: "loadDomains" });
      }
    }
    loadDomains();
  }, []);

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
          domain,
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

            {activeDomains.length > 0 ? (
              <FormControl fullWidth>
                <InputLabel id="domain-select-label">Domain</InputLabel>
                <Select
                  labelId="domain-select-label"
                  label="Domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  <MenuItem value={PRIMARY_DOMAIN}>{PRIMARY_DOMAIN}</MenuItem>
                  {activeDomains.map((d) => (
                    <MenuItem key={d} value={d}>
                      {d}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Domain: {PRIMARY_DOMAIN}
              </Typography>
            )}

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
