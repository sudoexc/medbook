import Link from "next/link";
import "./globals.css";

export default function RootNotFound() {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-white font-sans antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center">
          <p className="text-7xl font-bold tracking-tight text-blue-600">404</p>
          <h1 className="mt-4 text-2xl font-bold sm:text-3xl text-slate-900">
            Страница не найдена
          </h1>
          <p className="mt-3 max-w-md text-slate-600">
            Запрошенная страница не существует или была перемещена.
          </p>
          <Link
            href="/ru"
            className="mt-8 inline-flex items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            На главную
          </Link>
        </main>
      </body>
    </html>
  );
}
