"use client";

import { useState } from "react";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { getCountryInfo, ISO_NUMERIC_TO_ALPHA2 } from "@/lib/countries";

const GEO_URL = "/data/countries-110m.json";

interface CountryMapProps {
  countries: { code: string; count: number }[];
  countryClickMap: Record<string, number>;
  maxClicks: number;
}

export default function CountryMapSection({
  countries,
  countryClickMap,
  maxClicks,
}: CountryMapProps) {
  const theme = useTheme();
  const [tooltipContent, setTooltipContent] = useState("");
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const totalClicks = countries.reduce((sum, c) => sum + c.count, 0);
  const topCount = countries[0]?.count ?? 1;

  function getColor(clicks: number): string {
    if (!clicks) {
      return theme.palette.mode === "dark"
        ? alpha(theme.palette.action.hover, 0.08)
        : alpha(theme.palette.action.hover, 0.15);
    }
    const ratio = Math.log(clicks + 1) / Math.log(maxClicks + 1);
    const intensity = 0.2 + ratio * 0.8;
    return alpha(theme.palette.primary.main, intensity);
  }

  return (
    <>
      <Box
        sx={{
          mb: 2,
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
          position: "relative",
          bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
        }}
        onMouseLeave={() => setTooltipContent("")}
      >
        <ComposableMap
          projectionConfig={{ rotate: [-10, 0, 0], scale: 147 }}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <ZoomableGroup>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const iso = ISO_NUMERIC_TO_ALPHA2[geo.id] ?? geo.id ?? "";
                  const clicks = iso ? (countryClickMap[iso] || 0) : 0;
                  const info = getCountryInfo(iso);
                  const label = `${info.flag} ${info.name}: ${clicks.toLocaleString()} click${clicks !== 1 ? "s" : ""}`;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={getColor(clicks)}
                      stroke={alpha(theme.palette.divider, 0.4)}
                      strokeWidth={0.4}
                      onMouseEnter={(evt) => {
                        setTooltipContent(label);
                        setTooltipPos({ x: evt.clientX, y: evt.clientY });
                      }}
                      onMouseMove={(evt) => {
                        setTooltipPos({ x: evt.clientX, y: evt.clientY });
                      }}
                      onMouseLeave={() => setTooltipContent("")}
                      style={{
                        default: { outline: "none" },
                        hover: {
                          outline: "none",
                          fill: clicks
                            ? alpha(theme.palette.primary.main, 0.9)
                            : alpha(theme.palette.primary.light, 0.3),
                          cursor: "pointer",
                        },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {/* Floating tooltip that follows cursor */}
        {tooltipContent && (
          <Box
            sx={{
              position: "fixed",
              left: tooltipPos.x + 12,
              top: tooltipPos.y - 32,
              bgcolor: "background.paper",
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              boxShadow: 3,
              fontSize: 13,
              fontWeight: 500,
              pointerEvents: "none",
              zIndex: 1500,
              whiteSpace: "nowrap",
            }}
          >
            {tooltipContent}
          </Box>
        )}
      </Box>

      {/* Data Table */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 40 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Country</TableCell>
              <TableCell sx={{ fontWeight: 600, minWidth: 120 }}>Distribution</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Clicks</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>%</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {countries.map((c, i) => {
              const info = getCountryInfo(c.code);
              const pct = totalClicks > 0 ? ((c.count / totalClicks) * 100).toFixed(1) : "0";
              return (
                <TableRow key={c.code} hover>
                  <TableCell sx={{ color: "text.secondary" }}>{i + 1}</TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
                        {info.flag}
                      </Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {info.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <LinearProgress
                      variant="determinate"
                      value={(c.count / topCount) * 100}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {c.count.toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      {pct}%
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
