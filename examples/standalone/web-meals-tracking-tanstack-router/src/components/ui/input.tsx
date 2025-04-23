import clsx from "clsx";

const Input = ({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => {
  return (
    <input
      className={clsx(
        "border border-slate-300 rounded-sm px-2 py-1 text-sm focus:outline-slate-500",
        className
      )}
      {...props}
    />
  );
};

export { Input };
