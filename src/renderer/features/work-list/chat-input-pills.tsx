export function StepProgressBar({
  currentStep,
  totalSteps,
  stepName,
}: {
  currentStep: number;
  totalSteps: number;
  stepName: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2" style={{ width: '45%' }}>
      <span className="whitespace-nowrap text-micro tracking-micro font-medium text-text-passive">
        Step {currentStep} of {totalSteps}:
      </span>
      <span className="whitespace-nowrap text-micro tracking-micro font-semibold text-text-muted">
        {stepName}
      </span>
      <div className="ml-2 flex flex-1 gap-[3px]">
        {Array.from({ length: totalSteps }, (_, i) => (
          <span
            key={i}
            className={`h-[3px] flex-1 rounded-[2px] transition-colors duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] ${
              i < currentStep - 1
                ? 'bg-status-ok'
                : i === currentStep - 1
                  ? 'bg-action-bg'
                  : 'bg-surface-hover-solid'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
