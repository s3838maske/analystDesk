import { Checklist } from "./ui";

/** Shown instead of a step that cannot open yet because serious data problems are still open. */
export default function Blocked({ id, high, step }: { id: string; high: number; step?: string }) {
  return (
    <Checklist
      title={`${step ?? "This step"} opens once your data has no serious problems left:`}
      items={[
        {
          ok: false,
          text: `${high} serious data problem${high > 1 ? "s are" : " is"} still open`,
          hint: "These are numbers that look wrong, for example a balance sheet that does not balance. For each one, correct the number, accept it as reported, or override it with a reason.",
          href: `/analyses/${id}/validation`,
          cta: "Go to Flags and fix them",
        },
      ]}
    />
  );
}
