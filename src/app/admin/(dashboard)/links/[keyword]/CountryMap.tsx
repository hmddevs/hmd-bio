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
  Tooltip as MuiTooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
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
  const totalClicks = countries.reduce((sum, c) => sum + c.count, 0);

  function getColor(clicks: number): string {
    if (!clicks) {
      return theme.palette.mode === "dark" ? "#333" : "#e0e0e0";
    }
    // Stronger scale: min 30% intensity, log-based for better contrast
    const ratio = Math.log(clicks + 1) / Math.log(maxClicks + 1);
    const intensity = 0.3 + ratio * 0.7;
    return `color-mix(in srgb, ${theme.palette.primary.main} ${Math.round(intensity * 100)}%, ${theme.palette.mode === "dark" ? "#1e1e1e" : "#ffffff"})`;
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
        }}
      >
        <ComposableMap
          projectionConfig={{ rotate: [-10, 0, 0], scale: 147 }}
          style={{ width: "100%", height: "auto" }}
        >
          <ZoomableGroup>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const iso = ISO_NUMERIC_TO_ALPHA2[geo.id] ?? geo.id;
                  const clicks = countryClickMap[iso] || 0;
                  const info = getCountryInfo(iso);
                  const label = `${info.flag} ${info.name}: ${clicks.toLocaleString()} click${clicks !== 1 ? "s" : ""}`;
                  return (
                    <MuiTooltip key={geo.rsmKey} title={label} arrow placement="top">
                      <Geography
                        geography={geo}
                        fill={getColor(clicks)}
                        stroke={theme.palette.divider}
                        strokeWidth={0.5}
                        onMouseEnter={() => setTooltipContent(label)}
                        onMouseLeave={() => setTooltipContent("")}
                        style={{
                          default: { outline: "none" },
                          hover: {
                            outline: "none",
                            fill: theme.palette.primary.light,
                            cursor: "pointer",
                          },
                          pressed: { outline: "none" },
                        }}
                      />
                    </MuiTooltip>
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
        {tooltipContent && (
          <Box
            sx={{
              position: "absolute",
              bottom: 8,
              left: 8,
              bgcolor: "background.paper",
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              fontSize: 13,
              pointerEvents: "none",
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
              <TableCell sx={{ fontWeight: 600 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Country</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Clicks</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>%</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {countries.map((c, i) => {
              const info = getCountryInfo(c.code);
              const pct = totalClicks > 0 ? ((c.count / totalClicks) * 100).toFixed(1) : "0";
              return (
                <TableRow key={c.code}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    {info.flag} {info.name}
                  </TableCell>
                  <TableCell align="right">{c.count.toLocaleString()}</TableCell>
                  <TableCell align="right">{pct}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
