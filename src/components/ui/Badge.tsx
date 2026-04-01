type BadgeColor = "blue" | "yellow" | "orange" | "green" | "gray";

const colorStyles: Record<BadgeColor, string> = {
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  yellow: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  orange: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  green: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  gray: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
};

export default function Badge({
  color = "gray",
  children,
  className = "",
}: {
  color?: BadgeColor;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colorStyles[color]} ${className}`}
    >
      {children}
    </span>
  );
}
