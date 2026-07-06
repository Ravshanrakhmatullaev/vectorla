export type DemoAssetCategory = 'animals' | 'vehicles' | 'nature' | 'technology' | 'objects'

export interface DemoAsset {
  id: string
  title: string
  category: DemoAssetCategory
  file: string
  alt: string
}

// Placeholder entries only — no image files exist at these paths yet.
// See public/demo/README.md for the asset requirements these files must meet.
export const demoAssets: DemoAsset[] = [
  {
    id: 'parrot',
    title: 'Colorful Parrot',
    category: 'animals',
    file: '/demo/parrot.webp',
    alt: 'Colorful parrot illustration used as a vectorization example',
  },
  {
    id: 'eagle',
    title: 'Bald Eagle',
    category: 'animals',
    file: '/demo/eagle.webp',
    alt: 'Bald eagle illustration used as a vectorization example',
  },
  {
    id: 'lion',
    title: 'Lion Portrait',
    category: 'animals',
    file: '/demo/lion.webp',
    alt: 'Lion portrait illustration used as a vectorization example',
  },
  {
    id: 'tiger',
    title: 'Bengal Tiger',
    category: 'animals',
    file: '/demo/tiger.webp',
    alt: 'Bengal tiger illustration used as a vectorization example',
  },
  {
    id: 'wolf',
    title: 'Howling Wolf',
    category: 'animals',
    file: '/demo/wolf.webp',
    alt: 'Howling wolf illustration used as a vectorization example',
  },
  {
    id: 'butterfly',
    title: 'Monarch Butterfly',
    category: 'animals',
    file: '/demo/butterfly.webp',
    alt: 'Monarch butterfly illustration used as a vectorization example',
  },
  {
    id: 'fox',
    title: 'Red Fox',
    category: 'animals',
    file: '/demo/fox.webp',
    alt: 'Red fox illustration used as a vectorization example',
  },
  {
    id: 'koi-fish',
    title: 'Koi Fish',
    category: 'animals',
    file: '/demo/koi-fish.webp',
    alt: 'Koi fish illustration used as a vectorization example',
  },
  {
    id: 'dragon',
    title: 'Dragon',
    category: 'animals',
    file: '/demo/dragon.webp',
    alt: 'Dragon illustration used as a vectorization example',
  },
  {
    id: 'rose',
    title: 'Red Rose',
    category: 'nature',
    file: '/demo/rose.webp',
    alt: 'Red rose illustration used as a vectorization example',
  },
  {
    id: 'sunflower',
    title: 'Sunflower',
    category: 'nature',
    file: '/demo/sunflower.webp',
    alt: 'Sunflower illustration used as a vectorization example',
  },
  {
    id: 'tropical-leaf',
    title: 'Tropical Leaf',
    category: 'nature',
    file: '/demo/tropical-leaf.webp',
    alt: 'Tropical leaf illustration used as a vectorization example',
  },
  {
    id: 'supercar',
    title: 'Supercar',
    category: 'vehicles',
    file: '/demo/supercar.webp',
    alt: 'Supercar illustration used as a vectorization example',
  },
  {
    id: 'motorcycle',
    title: 'Motorcycle',
    category: 'vehicles',
    file: '/demo/motorcycle.webp',
    alt: 'Motorcycle illustration used as a vectorization example',
  },
  {
    id: 'camera',
    title: 'Vintage Camera',
    category: 'technology',
    file: '/demo/camera.webp',
    alt: 'Vintage camera illustration used as a vectorization example',
  },
  {
    id: 'robot',
    title: 'Robot',
    category: 'technology',
    file: '/demo/robot.webp',
    alt: 'Robot illustration used as a vectorization example',
  },
  {
    id: 'watch',
    title: 'Luxury Watch',
    category: 'objects',
    file: '/demo/watch.webp',
    alt: 'Luxury watch illustration used as a vectorization example',
  },
  {
    id: 'sneaker',
    title: 'Sneaker',
    category: 'objects',
    file: '/demo/sneaker.webp',
    alt: 'Sneaker illustration used as a vectorization example',
  },
  {
    id: 'guitar',
    title: 'Acoustic Guitar',
    category: 'objects',
    file: '/demo/guitar.webp',
    alt: 'Acoustic guitar illustration used as a vectorization example',
  },
  {
    id: 'diamond',
    title: 'Diamond',
    category: 'objects',
    file: '/demo/diamond.webp',
    alt: 'Diamond illustration used as a vectorization example',
  },
]
