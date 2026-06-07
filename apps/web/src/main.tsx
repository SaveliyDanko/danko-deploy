import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { App } from "./App.js";
import { RequireAuth } from "./components/RequireAuth.js";
import { AiAgentsPage } from "./pages/AiAgentsPage.js";
import { AiAgentTerminalPage } from "./pages/AiAgentTerminalPage.js";
import { BackupPage } from "./pages/BackupPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DeploymentDetailPage } from "./pages/DeploymentDetailPage.js";
import { DeploymentsPage } from "./pages/DeploymentsPage.js";
import { DocsPage, DocsSectionPage } from "./pages/DocsPage.js";
import { GitKeysPage } from "./pages/GitKeysPage.js";
import { KeysPage } from "./pages/KeysPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ProjectDetailPage } from "./pages/ProjectDetailPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { ServerDetailPage } from "./pages/ServerDetailPage.js";
import { ServerTerminalPage } from "./pages/ServerTerminalPage.js";
import { ServersPage } from "./pages/ServersPage.js";
import { VpnClientPage } from "./pages/VpnClientPage.js";
import { VpnPage } from "./pages/VpnPage.js";

import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  // Полноэкранный терминал — вне общего layout (на весь экран, удобно с телефона).
  {
    path: "/ai/:id/terminal",
    element: (
      <RequireAuth>
        <AiAgentTerminalPage />
      </RequireAuth>
    ),
  },
  {
    path: "/servers/:id/terminal",
    element: (
      <RequireAuth>
        <ServerTerminalPage />
      </RequireAuth>
    ),
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "projects/:id", element: <ProjectDetailPage /> },
      { path: "deployments", element: <DeploymentsPage /> },
      { path: "deployments/:id", element: <DeploymentDetailPage /> },
      { path: "servers", element: <ServersPage /> },
      { path: "servers/:id", element: <ServerDetailPage /> },
      { path: "keys", element: <KeysPage /> },
      { path: "git-keys", element: <GitKeysPage /> },
      { path: "ai", element: <AiAgentsPage /> },
      { path: "vpn", element: <VpnPage /> },
      { path: "vpn-client", element: <VpnClientPage /> },
      { path: "backup", element: <BackupPage /> },
      {
        path: "docs",
        element: <DocsPage />,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: ":section", element: <DocsSectionPage /> },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
