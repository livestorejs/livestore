import clsx from "clsx";

const Button = ({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  return (
    <button
      className={clsx(
        "border border-sky-300 text-sky-500 font-bold text-sm rounded-full py-2 hover:border-sky-600 transition-colors duration-150 hover:cursor-pointer hover:bg-sky-50",
        className
      )}
      {...props}
    />
  );
};

export { Button };
