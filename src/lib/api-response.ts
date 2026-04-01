import { NextResponse } from "next/server";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

export function apiSuccess<T>(data: T, statusCode = 200) {
  const body: ApiResponse<T> = { success: true, data, statusCode };
  return NextResponse.json(body, { status: statusCode });
}

export function apiError(error: string, statusCode = 400) {
  const body: ApiResponse = { success: false, error, statusCode };
  return NextResponse.json(body, { status: statusCode });
}
