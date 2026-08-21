import { useNavigate } from "react-router-dom";
import ArrivalsNav from "@/components/arrivals/ArrivalsNav";
import LiveTicker from "@/components/arrivals/LiveTicker";
import HeroSection from "@/components/arrivals/HeroSection";
import DestinationGrid from "@/components/arrivals/DestinationGrid";
import HowItWorks from "@/components/arrivals/HowItWorks";
import Guarantee from "@/components/arrivals/Guarantee";
import Reviews from "@/components/arrivals/Reviews";
import Ecosystem from "@/components/arrivals/Ecosystem";
import ArrivalsFooter from "@/components/arrivals/ArrivalsFooter";
import SupportTrigger from "@/components/arrivals/SupportTrigger";

export default function ArrivalsLanding() {
  const navigate = useNavigate();
  const goDestinations = () => navigate("/destinations");

  return (
    <div className="arrivals-scope min-h-screen bg-background" style={{ fontFamily: "var(--font-body)" }}>
      <ArrivalsNav />
      <main>
        <HeroSection onFindVisa={goDestinations} />
        <LiveTicker />
        <DestinationGrid onApply={goDestinations} />
        <HowItWorks />
        <Guarantee />
        <Reviews />
        <Ecosystem />
      </main>
      <ArrivalsFooter />
      <SupportTrigger />
    </div>
  );
}