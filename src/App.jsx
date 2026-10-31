import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./components/layout/MainLayout";
import RequireRole from "./components/layout/RequireRole";
import { Loading } from "./components/ui/States";
import { ADMIN_ROLES, OPERATOR_ROLES, STAFF_ROLES } from "./config/constants";
import { AuthProvider } from "./context/AuthContext";
import { DeviceProvider } from "./context/DeviceContext";
import { FeedbackProvider } from "./context/FeedbackContext";
import { ShopProvider } from "./context/ShopContext";

// Pages load on demand, so the login page doesn't download the charts etc.
const Shop = lazy(() => import("./pages/Shop"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Sensors = lazy(() => import("./pages/Sensors"));
const History = lazy(() => import("./pages/History"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Scheduler = lazy(() => import("./pages/Scheduler"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Users = lazy(() => import("./pages/Users"));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DeviceProvider>
          <FeedbackProvider>
            <ShopProvider>
            <Suspense fallback={<Loading fullPage />}>
              <Routes>
                {/* Sign-in pages: no sidebar */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />

                <Route element={<MainLayout />}>
                  {/* Public */}
                  <Route path="/" element={<Navigate to="/shop" replace />} />
                  <Route path="/shop" element={<Shop />} />

                  {/* Viewer, operator, administrator */}
                  <Route element={<RequireRole roles={STAFF_ROLES} />}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/sensors" element={<Sensors />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/analytics" element={<Analytics />} />
                  </Route>

                  {/* Operator, administrator */}
                  <Route element={<RequireRole roles={OPERATOR_ROLES} />}>
                    <Route path="/scheduler" element={<Scheduler />} />
                    <Route path="/inventory" element={<Inventory />} />
                  </Route>

                  {/* Administrator */}
                  <Route element={<RequireRole roles={ADMIN_ROLES} />}>
                    <Route path="/users" element={<Users />} />
                  </Route>
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            </ShopProvider>
          </FeedbackProvider>
        </DeviceProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
