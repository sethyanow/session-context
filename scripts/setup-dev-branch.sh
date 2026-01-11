#!/bin/bash
# Setup script for creating the dev branch
# Run this after merging the PR to set up the development workflow

set -e

echo "🚀 Setting up dev branch..."

# Check if we're on main
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "main" ]; then
    echo "⚠️  Warning: You're not on the main branch. Current branch: $current_branch"
    read -p "Do you want to continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create dev branch
echo "📌 Creating dev branch from current commit..."
git checkout -b dev

# Push dev branch to origin
echo "⬆️  Pushing dev branch to GitHub..."
git push -u origin dev

echo "✅ Dev branch created and pushed successfully!"
echo ""
echo "Next steps:"
echo "1. Go to GitHub Settings > Branches"
echo "2. Add branch protection rules for 'main' and 'dev' branches"
echo "3. See DEVELOPMENT.md for recommended protection rules"
echo ""
echo "Branch structure:"
echo "  main - Production releases (protected)"
echo "  dev  - Development integration (protected)"
echo "  feature/* - Feature branches (merge to dev)"
