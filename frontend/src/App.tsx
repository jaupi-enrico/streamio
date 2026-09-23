import type { JSX } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { queryClient } from "./lib/api";
import { routerBasename } from "./lib/base";
import { routes } from "./routes";

const router = createBrowserRouter(routes, { basename: routerBasename });

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
