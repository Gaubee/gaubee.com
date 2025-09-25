import { cn } from "@/lib/utils";
import styles from "./ContentScrollProgress.module.css";

export const ContentScrollProgress: React.FC<
  React.HTMLAttributes<HTMLDivElement>
> = (props) => {
  return (
    <div
      {...props}
      className={cn(styles.progress, "z-100", props.className)}
    ></div>
  );
};
