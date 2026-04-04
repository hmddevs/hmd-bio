import { NextResponse } from "next/server";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  suggestions?: string[];
  statusCode: number;
}

export function apiSuccess<T>(data: T, statusCode = 200) {
  const body: ApiResponse<T> = { success: true, data, statusCode };
  return NextResponse.json(body, { status: statusCode });
}

export function apiError(error: string, statusCode = 400, suggestions?: string[]) {
  const body: ApiResponse = { success: false, error, statusCode };
  if (suggestions?.length) body.suggestions = suggestions;
  return NextResponse.json(body, { status: statusCode });
}
