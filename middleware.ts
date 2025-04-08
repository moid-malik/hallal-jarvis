import { NextRequest, NextResponse } from "next/server";

// Create a route matcher for the chat stream API
const isPublicRoute = [
  "/api/chat/stream",
  "/",
  "/sign-in*",
  "/sign-up*",
];

// This function will exclude the chat stream API from any middleware processing
export default function middleware(req: NextRequest) {
  const { pathname } = new URL(req.url);
  
  // Skip all middleware processing for the chat stream API
  if (isPublicRoute.includes(pathname) || pathname === '/api/chat/stream') {
    return NextResponse.next();
  }
  
  // For all other routes, let the default Next.js middleware handle it
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Only run for API routes
    "/(api|trpc)(.*)",
  ],
};
