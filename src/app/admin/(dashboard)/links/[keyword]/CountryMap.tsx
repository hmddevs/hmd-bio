"use client";

import { Box, List, ListItem, ListItemText, Chip } from "@mui/material";
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

  return (
    <>
      <Box sx={{ mb: 2, border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
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
                  const intensity = clicks
                    ? 0.15 + (clicks / maxClicks) * 0.85
                    : 0;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={
                        clicks
                          ? `color-mix(in srgb, ${theme.palette.primary.main} ${Math.round(intensity * 100)}%, transparent)`
                          : theme.palette.mode === "dark"
                            ? "#333"
                            : "#e0e0e0"
                      }
                      stroke={theme.palette.divider}
                      strokeWidth={0.5}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", fill: theme.palette.primary.light },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
      </Box>
      <List dense>
        {countries.map((c) => {
          const info = getCountryInfo(c.code);
          return (
            <ListItem key={c.code} sx={{ px: 0 }}>
              <ListItemText
                primary={`${info.flag} ${info.name}`}
                primaryTypographyProps={{ fontSize: 13 }}
              />
              <Chip label={c.count} size="small" />
            </ListItem>
          );
        })}
      </List>
    </>
  );
}
