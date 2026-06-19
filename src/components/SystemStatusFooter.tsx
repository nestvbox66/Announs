import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SimBriefData } from "../types";

interface SystemStatusFooterProps {
  simBriefData: SimBriefData;
  passengerId?: string;
}

export default function SystemStatusFooter({ simBriefData, passengerId }: SystemStatusFooterProps) {
  const { t } = useTranslation();

  const gateId = useMemo(() => {
    if (passengerId) {
      const hash = passengerId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return "A" + ((hash % 30) + 1);
    }
    return "A01";
  }, [passengerId]);

  return (
    <div className="flex items-center justify-between w-full gap-4">
      <div className="flex items-center gap-3 text-[9px] font-mono text-white/50">
        <span className="uppercase tracking-wider">
          {t("passenger_details.footer.checkin", { origin: simBriefData.origen })}
        </span>
        <span className="text-white/20">|</span>
        <span className="uppercase tracking-wider">
          {t("passenger_details.footer.gate", { gate: gateId })}
        </span>
        <span className="text-white/20">|</span>
        <span className="text-[#43E600] uppercase tracking-wider">
          {t("passenger_details.footer.status", { status: "ACTIVE" })}
        </span>
      </div>
      {passengerId && (
        <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider">
          {t("passenger_details.footer.identifier", { id: passengerId })}
        </span>
      )}
    </div>
  );
}
