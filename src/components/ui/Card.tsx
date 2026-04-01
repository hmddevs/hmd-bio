interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
}

const paddingMap = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export default function Card({ children, className = "", padding = "md" }: CardProps) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm ${paddingMap[padding]} ${className}`}
    >
      {children}
    </div>
  );
}
