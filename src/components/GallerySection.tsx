import React, { useState, useEffect } from 'react';
import { X, ZoomIn } from 'lucide-react';
import { GalleryItem } from '../types';

interface GallerySectionProps {
  gallery: GalleryItem[];
}

export const GallerySection: React.FC<GallerySectionProps> = ({ gallery }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeImage, setActiveImage] = useState<GalleryItem | null>(null);

  useEffect(() => {
    if (!activeImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveImage(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeImage]);

  const filteredGallery =
    selectedCategory === 'All'
      ? gallery
      : gallery.filter(g => g.category === selectedCategory);

  return (
    <section id="gallery" className="py-16 sm:py-20 bg-neutral-50 border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-10 sm:mb-12">
          <div>
            <div className="text-xs font-semibold text-emerald-800 tracking-wider uppercase mb-2">
              Campus Life &amp; Visual Tour
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-neutral-950 font-display tracking-tight text-balance">
              Campus Gallery
            </h2>
          </div>

          {/* Category Filter Tabs */}
          <div
            role="tablist"
            aria-label="Filter gallery by category"
            className="flex items-center gap-1 p-1 bg-white border border-neutral-200 rounded-xl text-xs self-start md:self-auto max-w-full overflow-x-auto no-scrollbar"
          >
            {['All', 'Campus', 'Laboratories', 'Academics', 'Sports'].map(cat => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={selectedCategory === cat}
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[36px] px-3 py-1.5 font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-neutral-900 text-white shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Gallery Grid */}
        {filteredGallery.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredGallery.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveImage(item)}
                aria-label={`View photo: ${item.title}`}
                className="group relative text-left rounded-2xl overflow-hidden bg-white border border-neutral-200 hover:border-neutral-300 shadow-2xs cursor-pointer flex flex-col"
              >
                <div className="relative aspect-4/3 overflow-hidden bg-neutral-100 w-full">
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-neutral-950/20 group-hover:bg-neutral-950/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <div className="w-9 h-9 rounded-full bg-white/95 text-neutral-900 flex items-center justify-center shadow-md">
                      <ZoomIn className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between w-full">
                  <div>
                    <span className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider block mb-1">
                      {item.category}
                    </span>
                    <h3 className="text-xs font-bold text-neutral-900 leading-snug line-clamp-1">
                      {item.title}
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2 leading-relaxed">
                      {item.caption}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-10 rounded-2xl bg-white border border-neutral-200 text-center text-xs text-neutral-500">
            No photographs published under the <strong>{selectedCategory}</strong> category.
          </div>
        )}

        {/* Accessible Lightbox Modal */}
        {activeImage && (
          <div
            className="fixed inset-0 z-50 bg-neutral-950/85 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setActiveImage(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="gallery-lightbox-title"
              className="bg-neutral-950 rounded-2xl max-w-3xl w-full overflow-hidden border border-neutral-800 relative"
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setActiveImage(null)}
                aria-label="Close photo preview"
                className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 min-h-[40px] min-w-[40px] flex items-center justify-center text-white bg-neutral-950/70 hover:bg-neutral-900 border border-white/15 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="aspect-16/10 bg-neutral-900">
                <img
                  src={activeImage.image_url}
                  alt={activeImage.title}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="p-5 sm:p-6 text-white">
                <div className="text-xs text-emerald-400 font-semibold mb-1 uppercase tracking-wider">
                  {activeImage.category}
                </div>
                <h3 id="gallery-lightbox-title" className="text-base sm:text-lg font-bold font-display mb-1.5">
                  {activeImage.title}
                </h3>
                <p className="text-xs text-neutral-300 leading-relaxed">{activeImage.caption}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
