import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 dark:text-white">
          404
        </h1>
        <p className="mt-4 text-lg text-gray-500 dark:text-gray-400">
          This short URL doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition"
        >
          Go to HMD.bio
        </Link>
      </div>
    </div>
  );
}
