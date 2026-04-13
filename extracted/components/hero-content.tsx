"use client"

export default function HeroContent() {
  return (
    <main className="absolute bottom-6 left-4 sm:bottom-8 sm:left-8 z-20 max-w-xs sm:max-w-md lg:max-w-lg xl:max-w-xl">
      <div className="text-left">
        <div
          className="inline-flex items-center px-3 py-1 rounded-full bg-white/5 backdrop-blur-sm mb-4 relative"
          style={{
            filter: "url(#glass-effect)",
          }}
        >
          <div className="absolute top-0 left-1 right-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-full" />
          <span className="text-white/90 text-xs font-light relative z-10">✨ Driving healthcare reform</span>
        </div>

        {/* Main Heading */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl leading-tight tracking-tight font-light text-white mb-3 sm:mb-4">
          <span className="font-medium italic instrument">Anu</span> Ganugapati
        </h1>

        {/* Description */}
        <p className="text-sm sm:text-base lg:text-lg font-light text-white/70 mb-4 leading-relaxed">
          Driving healthcare reform by building tools and backing clinicians
        </p>

        {/* Buttons */}
        <div className="flex items-center gap-4 flex-wrap">
          <a
            href="https://linktr.ee/statdoctor"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3 rounded-full bg-white text-black font-normal text-xs transition-all duration-200 hover:bg-white/90 cursor-pointer"
          >
            Learn More
          </a>
        </div>
      </div>
    </main>
  )
}
