"use client";

import { useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

const BASE = typeof window !== "undefined" ? window.location.origin : "https://hmd.bio";

const bookmarklets = [
  {
    name: "Shorten (Popup)",
    description: "Opens a popup to shorten the current page.",
    code: `javascript:void(window.open('${BASE}/bookmarklet?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'hmd_shorten','width=480,height=360,scrollbars=no'))`,
  },
  {
    name: "Shorten (Custom Keyword)",
    description: "Prompts for a custom keyword, then opens a popup to shorten.",
    code: `javascript:void(function(){var k=prompt('Enter custom keyword (or leave blank):');if(k!==null)window.open('${BASE}/bookmarklet?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+(k?'&keyword='+encodeURIComponent(k):''),'hmd_shorten','width=480,height=360,scrollbars=no')}())`,
  },
  {
    name: "Quick Shorten",
    description: "Redirects to the dashboard with the URL pre-filled.",
    code: `javascript:location.href='${BASE}/dashboard/links/new?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)`,
  },
];

export default function AdminToolsPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Tools
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Drag any bookmarklet below to your browser&apos;s bookmark bar. Clicking it on any
        page will shorten that page&apos;s URL.
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {bookmarklets.map((bm) => (
          <Paper key={bm.name} variant="outlined" sx={{ p: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {bm.name}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Tooltip title="Copy bookmarklet code">
                  <IconButton size="small" onClick={() => handleCopy(bm.code)}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {bm.description}
            </Typography>
            {/* eslint-disable-next-line */}
            <a
              href={bm.code}
              onClick={(e) => e.preventDefault()}
              style={{
                display: "inline-block",
                padding: "8px 20px",
                borderRadius: 8,
                backgroundColor: "var(--mui-palette-primary-main, #3b82f6)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                textDecoration: "none",
                cursor: "grab",
              }}
            >
              {bm.name}
            </a>
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
              ↑ Drag this to your bookmark bar
            </Typography>
          </Paper>
        ))}
      </Box>

      <Alert severity="info" sx={{ mt: 4 }}>
        Bookmarklets use your current session for authentication. Make sure you&apos;re
        logged in to HMD.bio before using them.
      </Alert>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Copied to clipboard"
      />
    </Box>
  );
}
