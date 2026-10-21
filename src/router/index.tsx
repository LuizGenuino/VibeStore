import { createContext, lazy, Suspense, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { GuestOnly, NoStoreOnly, RequireAuth, RequireStore, SudoOnly } from './guards'
import { AuthLayout } from '@/layouts/AuthLayout'
import { AppLayout } from '@/layouts/AppLayout'
import { OnboardingLayout } from '@/layouts/OnboardingLayout'
import { SudoLayout } from '@/layouts/SudoLayout'
import { StorefrontLayout } from '@/layouts/StorefrontLayout'

/**
 * Mapa de rotas (guia 3) — paths idênticos ao contrato.
 * Lazy por página: a vitrine pública não carrega o bundle do painel.
 */
const LandingPage = lazy(() => import('@/pages/LandingPage'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const SignupPage = lazy(() => import('@/pages/auth/SignupPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))
const AuthCallbackPage = lazy(() => import('@/pages/auth/AuthCallbackPage'))

const PlanStepPage = lazy(() => import('@/pages/app/onboarding/PlanStepPage'))
const StoreStepPage = lazy(() => import('@/pages/app/onboarding/StoreStepPage'))

const DashboardPage = lazy(() => import('@/pages/app/DashboardPage'))
const ProfilePage = lazy(() => import('@/pages/app/ProfilePage'))
const StoreSettingsPage = lazy(() => import('@/pages/app/store/StoreSettingsPage'))
const CategoriesPage = lazy(() => import('@/pages/app/catalog/CategoriesPage'))
const ProductsPage = lazy(() => import('@/pages/app/catalog/ProductsPage'))
const ProductFormPage = lazy(() => import('@/pages/app/catalog/ProductFormPage'))
const InventoryPage = lazy(() => import('@/pages/app/inventory/InventoryPage'))
const MovementsPage = lazy(() => import('@/pages/app/inventory/MovementsPage'))
const OrdersPage = lazy(() => import('@/pages/app/orders/OrdersPage'))
const OrderDetailPage = lazy(() => import('@/pages/app/orders/OrderDetailPage'))
const CustomersPage = lazy(() => import('@/pages/app/customers/CustomersPage'))
const ExpensesPage = lazy(() => import('@/pages/app/expenses/ExpensesPage'))
const ExpenseCategoriesPage = lazy(() => import('@/pages/app/expenses/ExpenseCategoriesPage'))
const ReportsPage = lazy(() => import('@/pages/app/reports/ReportsPage'))

const SudoHomePage = lazy(() => import('@/pages/sudo/SudoHomePage'))
const SudoUsersPage = lazy(() => import('@/pages/sudo/SudoUsersPage'))
const SudoRolesPage = lazy(() => import('@/pages/sudo/SudoRolesPage'))
const SudoPermissionsPage = lazy(() => import('@/pages/sudo/SudoPermissionsPage'))
const SudoRolePermissionsPage = lazy(() => import('@/pages/sudo/SudoRolePermissionsPage'))

const StorefrontHomePage = lazy(() => import('@/pages/storefront/StorefrontHomePage'))
const StorefrontProductPage = lazy(() => import('@/pages/storefront/StorefrontProductPage'))
const StorefrontCartPage = lazy(() => import('@/pages/storefront/StorefrontCartPage'))
const StorefrontCheckoutPage = lazy(() => import('@/pages/storefront/StorefrontCheckoutPage'))
const StorefrontOrderPage = lazy(() => import('@/pages/storefront/StorefrontOrderPage'))
const StorefrontNotFound = lazy(() => import('@/pages/storefront/StorefrontNotFound'))
const StorefrontOrderSuccess = lazy(() => import('@/pages/storefront/StorefrontOrderSuccess'))

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function PageLoader() {
    return (
        <div className="flex min-h-[50vh] items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
    )
}

export const LoadContext = createContext<{
    loading: boolean
    setLoading: Dispatch<SetStateAction<boolean>>
}>({
    loading: false,
    setLoading: () => { },
})

export function AppRouter() {
    const [loading, setLoading] = useState(false)
    return (
        <>
            {loading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
            )}
            <LoadContext.Provider value={{ loading, setLoading }}>
                <BrowserRouter>
                    <Suspense fallback={<PageLoader />}>
                        <Routes>
                            {/* Landing pública */}
                            <Route path="/" element={<LandingPage />} />

                            {/* Auth (público / guest-only) */}
                            <Route element={<AuthLayout />}>
                                <Route path="/auth/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                                <Route path="/auth/signup" element={<GuestOnly><SignupPage /></GuestOnly>} />
                                <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
                                <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
                                <Route path="/auth/callback" element={<AuthCallbackPage />} />
                            </Route>

                            {/* Onboarding: autenticado SEM loja */}
                            <Route
                                element={
                                    <NoStoreOnly>
                                        <OnboardingLayout />
                                    </NoStoreOnly>
                                }
                            >
                                <Route path="/app/onboarding" element={<Navigate to="/app/onboarding/plan" replace />} />
                                <Route path="/app/onboarding/plan" element={<PlanStepPage />} />
                                <Route path="/app/onboarding/store" element={<StoreStepPage />} />
                            </Route>

                            {/* App autenticado */}
                            <Route
                                element={
                                    <RequireAuth>
                                        <AppLayout />
                                    </RequireAuth>
                                }
                            >
                                <Route path="/app" element={<RequireStore perm="store.read"><DashboardPage /></RequireStore>} />
                                <Route path="/app/profile" element={<ProfilePage />} />
                                <Route path="/app/store/settings" element={<RequireStore perm="store.read"><StoreSettingsPage /></RequireStore>} />
                                <Route path="/app/catalog/categories" element={<RequireStore perm="catalog.read"><CategoriesPage /></RequireStore>} />
                                <Route path="/app/catalog/products" element={<RequireStore perm="catalog.read"><ProductsPage /></RequireStore>} />
                                <Route path="/app/catalog/products/new" element={<RequireStore perm="catalog.products.manage"><ProductFormPage /></RequireStore>} />
                                <Route path="/app/catalog/products/:productId" element={<RequireStore perm="catalog.read"><ProductFormPage /></RequireStore>} />
                                <Route path="/app/inventory" element={<RequireStore perm="inventory.read"><InventoryPage /></RequireStore>} />
                                <Route path="/app/inventory/movements" element={<RequireStore perm="inventory.read"><MovementsPage /></RequireStore>} />
                                <Route path="/app/orders" element={<RequireStore perm="orders.read"><OrdersPage /></RequireStore>} />
                                <Route path="/app/orders/:orderId" element={<RequireStore perm="orders.read"><OrderDetailPage /></RequireStore>} />
                                <Route path="/app/customers" element={<RequireStore perm="customers.read"><CustomersPage /></RequireStore>} />
                                <Route path="/app/expenses" element={<RequireStore perm="expenses.read"><ExpensesPage /></RequireStore>} />
                                <Route path="/app/expenses/categories" element={<RequireStore perm="expenses.read"><ExpenseCategoriesPage /></RequireStore>} />
                                <Route path="/app/reports" element={<RequireStore perm="reports.read"><ReportsPage /></RequireStore>} />
                            </Route>

                            {/* Painel SUDO */}
                            <Route
                                element={
                                    <SudoOnly>
                                        <SudoLayout />
                                    </SudoOnly>
                                }
                            >
                                <Route path="/sudo" element={<SudoHomePage />} />
                                <Route path="/sudo/users" element={<SudoUsersPage />} />
                                <Route path="/sudo/roles" element={<SudoRolesPage />} />
                                <Route path="/sudo/permissions" element={<SudoPermissionsPage />} />
                                <Route path="/sudo/role-permissions" element={<SudoRolePermissionsPage />} />
                            </Route>

                            {/* Vitrine pública (Edge storefront-api; token de pedido via #fragmento) */}
                            <Route path="/s/:storeSlug" element={<StorefrontLayout />}>
                                <Route index element={<StorefrontHomePage />} />
                                <Route path="produto/:productSlug" element={<StorefrontProductPage />} />
                                <Route path="carrinho" element={<StorefrontCartPage />} />
                                <Route path="checkout" element={<StorefrontCheckoutPage />} />
                                <Route path="pedido/sucesso" element={<StorefrontOrderSuccess />} />
                                <Route path="pedido/:orderId" element={<StorefrontOrderPage />} />
                                <Route path="*" element={<StorefrontNotFound />} />
                            </Route>

                            <Route path="*" element={<NotFoundPage />} />
                        </Routes>
                    </Suspense>
                </BrowserRouter>
            </LoadContext.Provider>
        </>
    )
}
